import type { Me } from '@smart/contracts';
import type { User } from './identity.schema.js';

/** The part of `Me` that identity owns; `MeService` adds the households. */
export type IdentityMe = Omit<Me, 'households' | 'currentHouseholdId'>;

export function toMe(user: User): IdentityMe {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    appearance: user.appearance,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}
