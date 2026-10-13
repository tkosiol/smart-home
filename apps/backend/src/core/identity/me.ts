import type { Me } from '@smart/contracts';
import type { User } from './identity.schema.js';

export function toMe(user: User): Me {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    appearance: user.appearance,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}
