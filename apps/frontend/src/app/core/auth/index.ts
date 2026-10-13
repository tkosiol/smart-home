import { Injector, inject, type Provider } from '@angular/core';
import { UNAUTHORIZED_HANDLER } from '../api';
import { AuthService } from './auth.service';

export { AuthService, type AuthStatus } from './auth.service';
export { ME_CACHE, LocalStorageMeCache, type MeCache } from './me-cache';
export { safeTarget } from './safe-target';
export { signedIn } from './signed-in.guard';

/**
 * Hands a 401 of any API request to the AuthService. The service is looked up when the 401
 * arrives: the API client needs this handler, the service needs the API client.
 */
export function provideAuth(): Provider {
  return {
    provide: UNAUTHORIZED_HANDLER,
    useFactory: () => {
      const injector = inject(Injector);
      return () => injector.get(AuthService).handleUnauthorized();
    },
  };
}
