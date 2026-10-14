import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import type { InstanceAppearance } from '@smart/contracts';
import { INSTANCE_APPEARANCE } from './instance-appearance.token';
import { ThemeService } from './theme.service';

export interface ThemeOptions {
  /** Instance default from the runtime config; without it the build default applies. */
  readonly instance?: InstanceAppearance;
}

/** Starts the ThemeService with the app so the theme applies on boot. */
export function provideTheme(options: ThemeOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...(options.instance ? [{ provide: INSTANCE_APPEARANCE, useValue: options.instance }] : []),
    provideEnvironmentInitializer(() => {
      inject(ThemeService);
    }),
  ]);
}
