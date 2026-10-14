import { Injectable } from '@nestjs/common';
import type { Me } from '@smart/contracts';
import type { MeHouseholds } from '../identity/index.js';
import { HouseholdsRepository } from './households.repository.js';

/** The households part of `/me`, provided to identity through `ME_HOUSEHOLDS`. */
@Injectable()
export class MeHouseholdsSource implements MeHouseholds {
  constructor(private readonly households: HouseholdsRepository) {}

  async forUser(
    userId: string,
    lastHouseholdId: string | null,
  ): Promise<Pick<Me, 'households' | 'currentHouseholdId'>> {
    const own = await this.households.listForUser(userId); // oldest membership first
    const current = own.find((household) => household.id === lastHouseholdId) ?? own[0];
    return {
      households: own
        .map(({ id, name, timezone, role }) => ({ id, name, timezone, role }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      currentHouseholdId: current?.id ?? null,
    };
  }
}
