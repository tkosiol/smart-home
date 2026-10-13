import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Me } from '@smart/contracts';
import type { User } from './identity.schema.js';
import { toMe } from './me.js';

/** What core/households provides for `/me`; identity defines it so it never imports households. */
export interface MeHouseholds {
  forUser(
    userId: string,
    lastHouseholdId: string | null,
  ): Promise<Pick<Me, 'households' | 'currentHouseholdId'>>;
}
export const ME_HOUSEHOLDS = Symbol('ME_HOUSEHOLDS');

@Injectable()
export class MeService {
  constructor(@Optional() @Inject(ME_HOUSEHOLDS) private readonly households?: MeHouseholds) {}

  async forUser(user: User): Promise<Me> {
    const extra = (await this.households?.forUser(user.id, user.lastHouseholdId)) ?? {
      households: [],
      currentHouseholdId: null,
    };
    return { ...toMe(user), ...extra };
  }
}
