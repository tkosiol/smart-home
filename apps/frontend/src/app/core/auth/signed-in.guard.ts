import { inject } from '@angular/core';
import { Router, type CanMatchFn, type UrlSegment } from '@angular/router';
import { AuthService } from './auth.service';

/** The URL being navigated to; a canMatch guard only receives the segments of its own level. */
function targetUrl(router: Router, segments: UrlSegment[]): string {
  const extracted = router.currentNavigation()?.extractedUrl;
  return extracted ? router.serializeUrl(extracted) : `/${segments.map((s) => s.path).join('/')}`;
}

/**
 * Lets signed-in users (also those started offline from the device's copy) through. Everyone else
 * is sent to the sign-in page, which leads back to where they wanted to go (`ziel`).
 */
export const signedIn: CanMatchFn = async (_route, segments) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const target = targetUrl(router, segments);
  await auth.ready();
  if (auth.status() === 'signedIn' || auth.status() === 'offline') return true;
  return router.createUrlTree(['/anmelden'], {
    queryParams: target === '/' ? undefined : { ziel: target },
  });
};
