import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import { hasRole, type HouseholdRole } from '@smart/contracts';
import { AuthService } from '../auth';
import { HouseholdContext } from './household-context';

// All guards wait for the first answer about the user and are closed without one, so a guard
// that runs beside `signedIn` never lets anybody through by accident.

/** The shell shows a household; whoever has none is sent to the set-up page. */
export const hasHousehold: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const household = inject(HouseholdContext);
  const router = inject(Router);
  await auth.ready();
  return household.current() !== null || router.parseUrl('/einrichten');
};

/** The role in the current household must be at least `role`; otherwise the user goes to the overview. */
export function minRole(role: HouseholdRole): CanMatchFn {
  return async () => {
    const auth = inject(AuthService);
    const household = inject(HouseholdContext);
    const router = inject(Router);
    await auth.ready();
    const current = household.current();
    return (current !== null && hasRole(current.role, role)) || router.parseUrl('/');
  };
}

/** Pages of the installation are for the platform admin only (also by URL). */
export const platformAdmin: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  return auth.me()?.isPlatformAdmin === true || router.parseUrl('/mehr/einstellungen');
};
