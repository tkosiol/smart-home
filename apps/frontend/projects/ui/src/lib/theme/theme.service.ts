import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  DEFAULT_PERSONAL_APPEARANCE,
  instanceAppearanceSchema,
  personalAppearanceSchema,
  type InstanceAppearance,
  type PersonalAppearance,
} from '@smart/contracts';
import { resolveAppearance } from '@smart/theme/resolve';
import type { ResolvedContrast, ResolvedMode } from '@smart/theme';
import { APPEARANCE_STORE, BOOT_CACHE_VERSION } from './appearance-store';
import { applyThemeVars } from './apply-theme';
import { INSTANCE_APPEARANCE } from './instance-appearance.token';
import { MEDIA_QUERIES } from './media-queries';
import { THEME_ENGINE_LOADER, type ThemeEngine } from './theme-engine';

const DARK = '(prefers-color-scheme: dark)';
const MORE_CONTRAST = '(prefers-contrast: more)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(APPEARANCE_STORE);
  private readonly media = inject(MEDIA_QUERIES);
  private readonly defaultInstance = inject(INSTANCE_APPEARANCE);
  private readonly engine = signal<ThemeEngine | null>(null);
  private readonly personalListeners = new Set<(value: PersonalAppearance) => void>();
  private readonly instanceListeners = new Set<(value: InstanceAppearance | null) => void>();

  private readonly instanceState = signal<InstanceAppearance>(this.loadInstance());
  private readonly personalState = signal<PersonalAppearance>(this.loadPersonal());
  readonly instance = this.instanceState.asReadonly();
  readonly personal = this.personalState.asReadonly();
  private readonly prefersDark = signal(this.media.matches(DARK));
  private readonly prefersMoreContrast = signal(this.media.matches(MORE_CONTRAST));

  /**
   * Settles once the color engine is loaded (or failed to load). Until then the theme from
   * `theme-boot.js` and the default CSS stays; `resolved` works without the engine.
   */
  readonly ready: Promise<void>;

  readonly resolved = computed(() =>
    resolveAppearance(this.instance(), this.personal(), {
      prefersDark: this.prefersDark(),
      prefersMoreContrast: this.prefersMoreContrast(),
    }),
  );

  constructor() {
    const stopDark = this.media.listen(DARK, (matches) => this.prefersDark.set(matches));
    const stopContrast = this.media.listen(MORE_CONTRAST, (matches) =>
      this.prefersMoreContrast.set(matches),
    );
    // Another tab stored a change: follow it so all open tabs look the same.
    const stopWatching = this.store.watch((key) =>
      key === 'instance'
        ? this.instanceState.set(this.loadInstance())
        : this.personalState.set(this.loadPersonal()),
    );
    inject(DestroyRef).onDestroy(() => {
      stopDark();
      stopContrast();
      stopWatching();
    });
    this.ready = inject(THEME_ENGINE_LOADER)()
      .then((engine) => this.engine.set(engine))
      .catch((error: unknown) =>
        console.warn('Theme engine could not be loaded, keeping the default theme', error),
      );
    effect(() => this.apply());
  }

  /** The user changed their appearance (editor, reset): applies, stores and tells the listeners. */
  setPersonal(value: PersonalAppearance): void {
    const parsed = personalAppearanceSchema.parse(value);
    this.personalState.set(parsed);
    this.store.savePersonal(parsed);
    this.notifyPersonal(parsed);
  }

  /** Back to the defaults: instance colors, system mode and contrast. */
  resetPersonal(): void {
    this.personalState.set(DEFAULT_PERSONAL_APPEARANCE);
    this.store.clearPersonal();
    this.notifyPersonal(DEFAULT_PERSONAL_APPEARANCE);
  }

  /** Takes over an appearance that did not come from the user (the account on the server): no listener hears of it. */
  adoptPersonal(value: PersonalAppearance): void {
    const parsed = personalAppearanceSchema.parse(value);
    this.personalState.set(parsed);
    this.store.savePersonal(parsed);
  }

  /** Calls back after every change the user makes, never for `adoptPersonal` or another tab; returns the unsubscribe function. */
  onPersonalChange(listener: (value: PersonalAppearance) => void): () => void {
    this.personalListeners.add(listener);
    return () => void this.personalListeners.delete(listener);
  }

  resetPersonalColors(): void {
    const { mode, contrast } = this.personal();
    this.setPersonal({ mode, contrast });
  }

  /** The platform admin changed the instance appearance: applies, keeps the copy and tells the listeners. */
  setInstance(value: InstanceAppearance): void {
    const parsed = instanceAppearanceSchema.parse(value);
    this.instanceState.set(parsed);
    this.store.saveInstance(parsed);
    this.notifyInstance(parsed);
  }

  /** The platform admin removed the stored value: config.json or the build default applies; listeners hear `null`. */
  resetInstance(): void {
    this.instanceState.set(this.defaultInstance);
    this.store.clearInstance();
    this.notifyInstance(null);
  }

  /**
   * Takes over the server's value; `null` means none is stored there, so config.json or the build
   * default applies. The value is kept on the device for the next start. No listener hears of it.
   */
  adoptInstance(value: InstanceAppearance | null): void {
    if (value === null) {
      this.store.clearInstance();
      this.instanceState.set(this.defaultInstance);
      return;
    }
    const parsed = instanceAppearanceSchema.parse(value);
    this.store.saveInstance(parsed);
    this.instanceState.set(parsed);
  }

  /** Calls back after every change the admin makes (`null` for a reset), never for `adoptInstance` or another tab; returns the unsubscribe function. */
  onInstanceChange(listener: (value: InstanceAppearance | null) => void): () => void {
    this.instanceListeners.add(listener);
    return () => void this.instanceListeners.delete(listener);
  }

  /** Precedence (spec 3.8): the server's value (cached on the device), config.json, build default. */
  private loadInstance(): InstanceAppearance {
    return this.store.loadInstance() ?? this.defaultInstance;
  }

  private notifyInstance(value: InstanceAppearance | null): void {
    for (const listener of this.instanceListeners) listener(value);
  }

  private notifyPersonal(value: PersonalAppearance): void {
    for (const listener of this.personalListeners) listener(value);
  }

  private loadPersonal(): PersonalAppearance {
    return this.store.loadPersonal() ?? DEFAULT_PERSONAL_APPEARANCE;
  }

  private apply(): void {
    const engine = this.engine();
    const resolved = this.resolved();
    if (!engine) return;
    const vars = (mode: ResolvedMode, contrast: ResolvedContrast) =>
      engine.computeThemeVars({ ...resolved, mode, contrast });
    applyThemeVars(
      this.document.documentElement,
      vars(resolved.mode, resolved.contrast),
      resolved.mode,
    );
    const { mode, contrast } = this.personal();
    const followsSystemContrast = contrast === 'system';
    const cached = followsSystemContrast ? 'standard' : resolved.contrast;
    this.store.saveBootCache({
      v: BOOT_CACHE_VERSION,
      mode,
      followsSystemContrast,
      light: vars('light', cached),
      dark: vars('dark', cached),
      ...(followsSystemContrast
        ? { lightHigh: vars('light', 'high'), darkHigh: vars('dark', 'high') }
        : {}),
    });
  }
}
