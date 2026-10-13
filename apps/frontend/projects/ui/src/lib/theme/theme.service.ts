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
import { INSTANCE_APPEARANCE, STORED_INSTANCE_ALLOWED } from './instance-appearance.token';
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
  private readonly storedInstanceAllowed = inject(STORED_INSTANCE_ALLOWED);
  private readonly engine = signal<ThemeEngine | null>(null);

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

  setPersonal(value: PersonalAppearance): void {
    const parsed = personalAppearanceSchema.parse(value);
    this.personalState.set(parsed);
    this.store.savePersonal(parsed);
  }

  /** Back to the defaults: instance colors, system mode and contrast. */
  resetPersonal(): void {
    this.personalState.set(DEFAULT_PERSONAL_APPEARANCE);
    this.store.clearPersonal();
  }

  resetPersonalColors(): void {
    const { mode, contrast } = this.personal();
    this.setPersonal({ mode, contrast });
  }

  setInstance(value: InstanceAppearance): void {
    const parsed = instanceAppearanceSchema.parse(value);
    this.instanceState.set(parsed);
    if (this.storedInstanceAllowed) this.store.saveInstance(parsed);
  }

  /** Back to the installation default (config.json, else the build default). */
  resetInstance(): void {
    this.instanceState.set(this.defaultInstance);
    this.store.clearInstance();
  }

  /** Precedence (spec 4.5): stored instance (only while the editor is on), config.json, build default. */
  private loadInstance(): InstanceAppearance {
    return (this.storedInstanceAllowed ? this.store.loadInstance() : null) ?? this.defaultInstance;
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
