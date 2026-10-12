import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import type { InstanceAppearance } from '@smart/contracts';
import { INSTANCE_APPEARANCE, STORED_INSTANCE_ALLOWED } from './instance-appearance.token';
import { ThemeService } from './theme.service';

export interface ThemeOptions {
  /** Instance default from the runtime config; without it the build default applies. */
  readonly instance?: InstanceAppearance;
  /** True while the instance appearance editor is enabled (runtime config). */
  readonly allowStoredInstance?: boolean;
}

/** Starts the ThemeService with the app so the theme applies on boot. */
export function provideTheme(options: ThemeOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...(options.instance ? [{ provide: INSTANCE_APPEARANCE, useValue: options.instance }] : []),
    { provide: STORED_INSTANCE_ALLOWED, useValue: options.allowStoredInstance ?? false },
    provideEnvironmentInitializer(() => {
      inject(ThemeService);
    }),
  ]);
}
