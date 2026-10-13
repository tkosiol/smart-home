import { SetMetadata } from '@nestjs/common';
import type { HouseholdRole } from '@smart/contracts';

export const REQUIRED_ROLE = 'households:requiredRole';

/** The minimum role a household route needs; `HouseholdGuard` fails closed without it. */
export const RequireRole = (role: HouseholdRole) => SetMetadata(REQUIRED_ROLE, role);
