import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  DEFAULT_PERSONAL_APPEARANCE,
  instanceAppearanceSchema,
  personalAppearanceSchema,
  type InstanceAppearance,
  type PersonalAppearance,
} from '@smart/contracts';
import { computeThemeVars, resolveAppearance } from '@smart/theme';
import { APPEARANCE_STORE } from './appearance-store';
import { applyThemeVars } from './apply-theme';
import { INSTANCE_APPEARANCE } from './instance-appearance.token';
import { MEDIA_QUERIES } from './media-queries';

const DARK = '(prefers-color-scheme: dark)';
const MORE_CONTRAST = '(prefers-contrast: more)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(APPEARANCE_STORE);
  private readonly media = inject(MEDIA_QUERIES);

  readonly instance = signal<InstanceAppearance>(
    this.store.loadInstance() ?? inject(INSTANCE_APPEARANCE),
  );
  readonly personal = signal<PersonalAppearance>(
    this.store.loadPersonal() ?? DEFAULT_PERSONAL_APPEARANCE,
  );
  private readonly prefersDark = signal(this.media.matches(DARK));
  private readonly prefersMoreContrast = signal(this.media.matches(MORE_CONTRAST));

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
    inject(DestroyRef).onDestroy(() => {
      stopDark();
      stopContrast();
    });
    effect(() => this.apply());
  }

  setPersonal(value: PersonalAppearance): void {
    const parsed = personalAppearanceSchema.parse(value);
    this.personal.set(parsed);
    this.store.savePersonal(parsed);
  }

  resetPersonalColors(): void {
    const { mode, contrast } = this.personal();
    this.setPersonal({ mode, contrast });
  }

  setInstance(value: InstanceAppearance): void {
    const parsed = instanceAppearanceSchema.parse(value);
    this.instance.set(parsed);
    this.store.saveInstance(parsed);
  }

  private apply(): void {
    const resolved = this.resolved();
    const light = computeThemeVars({ ...resolved, mode: 'light' });
    const dark = computeThemeVars({ ...resolved, mode: 'dark' });
    applyThemeVars(
      this.document.documentElement,
      resolved.mode === 'dark' ? dark : light,
      resolved.mode,
    );
    // Both modes are cached so theme-boot.js can follow the system setting without a flash.
    this.store.saveBootCache({ mode: this.personal().mode, light, dark });
  }
}
