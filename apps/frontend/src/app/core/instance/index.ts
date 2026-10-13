import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { InstanceAppearanceSync } from './instance-appearance-sync';

export { InstanceAppearanceSync } from './instance-appearance-sync';

/** Starts the sync of the instance appearance with the server at app start. */
export function provideInstanceAppearance(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      inject(InstanceAppearanceSync);
    }),
  ]);
}
