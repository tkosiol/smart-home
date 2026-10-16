import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AttentionList } from '@smart/contracts';
import {
  HouseholdGuard,
  membershipOf,
  RequireRole,
  type HouseholdRequest,
} from '../households/index.js';
import { UsersRepository } from '../identity/index.js';
import { AttentionService } from './attention.service.js';

@Controller('v1/households/:householdId')
@UseGuards(HouseholdGuard)
export class AttentionController {
  constructor(
    private readonly attention: AttentionService,
    private readonly users: UsersRepository,
  ) {}

  @Get('attention')
  @RequireRole('viewer')
  async list(@Req() request: HouseholdRequest): Promise<AttentionList> {
    const membership = membershipOf(request);
    const user = request.user ? await this.users.findById(request.user.id) : undefined;
    await this.attention.ensureComputed(membership.householdId);
    return {
      items: this.attention.list(
        membership.householdId,
        membership.role,
        user?.isPlatformAdmin ?? false,
      ),
    };
  }
}
