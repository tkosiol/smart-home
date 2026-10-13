import { Global, Module } from '@nestjs/common';
import { IdentityModule, ME_HOUSEHOLDS } from '../identity/index.js';
import { HouseholdGuard } from './household.guard.js';
import { HouseholdController, HouseholdsController } from './households.controller.js';
import { HouseholdsRepository } from './households.repository.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { MeHouseholdsSource } from './me-households.js';
import { MembershipsRepository } from './memberships.repository.js';

/** Global so that identity can pick up `ME_HOUSEHOLDS` without importing this module. */
@Global()
@Module({
  imports: [IdentityModule],
  controllers: [HouseholdsController, HouseholdController, MembersController],
  providers: [
    HouseholdsRepository,
    MembershipsRepository,
    MembersService,
    HouseholdGuard,
    MeHouseholdsSource,
    { provide: ME_HOUSEHOLDS, useExisting: MeHouseholdsSource },
  ],
  exports: [ME_HOUSEHOLDS],
})
export class HouseholdsModule {}
