import { Global, Module } from '@nestjs/common';
import { MailModule } from '../../platform/mail/index.js';
import { IdentityModule, ME_HOUSEHOLDS } from '../identity/index.js';
import { HouseholdsCleanupJob } from './cleanup.job.js';
import { HouseholdGuard } from './household.guard.js';
import { HouseholdController, HouseholdsController } from './households.controller.js';
import { HouseholdsRepository } from './households.repository.js';
import { InstanceController } from './instance.controller.js';
import { InstanceSettingsRepository } from './instance-settings.repository.js';
import { InvitationAcceptController } from './invitation-accept.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsRepository } from './invitations.repository.js';
import { InvitationsService } from './invitations.service.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { MeHouseholdsSource } from './me-households.js';
import { MembershipsRepository } from './memberships.repository.js';

/** Global so that identity can pick up `ME_HOUSEHOLDS` without importing this module. */
@Global()
@Module({
  imports: [IdentityModule, MailModule],
  controllers: [
    HouseholdsController,
    HouseholdController,
    MembersController,
    InvitationsController,
    InvitationAcceptController,
    InstanceController,
  ],
  providers: [
    HouseholdsRepository,
    InstanceSettingsRepository,
    MembershipsRepository,
    MembersService,
    InvitationsRepository,
    InvitationsService,
    HouseholdsCleanupJob,
    HouseholdGuard,
    MeHouseholdsSource,
    { provide: ME_HOUSEHOLDS, useExisting: MeHouseholdsSource },
  ],
  // The guard and the memberships serve other core modules' `v1/households/:householdId` routes.
  exports: [ME_HOUSEHOLDS, HouseholdGuard, MembershipsRepository],
})
export class HouseholdsModule {}
