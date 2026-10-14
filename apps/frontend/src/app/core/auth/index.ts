import {
  Injector,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { UNAUTHORIZED_HANDLER } from '../api';
import { AuthService } from './auth.service';
import { PreferencesSync } from './preferences-sync';

export { AuthService, type AuthStatus } from './auth.service';
export { ME_CACHE, LocalStorageMeCache, type MeCache } from './me-cache';
export {
  PENDING_PREFERENCES,
  LocalStoragePendingPreferences,
  type PendingPreferences,
  type PendingPreferencesStore,
} from './pending-preferences';
export { PreferencesSync } from './preferences-sync';
export { safeTarget } from './safe-target';
export { signedIn } from './signed-in.guard';

/**
 * Hands a 401 of any API request to the AuthService (looked up when the 401 arrives: the API
 * client needs this handler, the service needs the API client) and starts the sync of theme and
 * language with the account.
 */
export function provideAuth(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: UNAUTHORIZED_HANDLER,
      useFactory: () => {
        const injector = inject(Injector);
        return () => injector.get(AuthService).handleUnauthorized();
      },
    },
    provideEnvironmentInitializer(() => {
      inject(PreferencesSync);
    }),
  ]);
}
