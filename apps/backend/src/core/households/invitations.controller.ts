import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { invitationCreateSchema, type Invitation, type InvitationCreated } from '@smart/contracts';
import { HouseholdGuard, membershipOf, type HouseholdRequest } from './household.guard.js';
import { InvitationsService } from './invitations.service.js';
import { RequireRole } from './require-role.decorator.js';

/** Owners manage the open invitations of their household. */
@Controller('v1/households/:householdId/invitations')
@UseGuards(HouseholdGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequireRole('owner')
  list(@Req() request: HouseholdRequest): Promise<Invitation[]> {
    return this.invitations.list(membershipOf(request).householdId);
  }

  @Post()
  @RequireRole('owner')
  create(@Req() request: HouseholdRequest, @Body() body: unknown): Promise<InvitationCreated> {
    return this.invitations.create(membershipOf(request), invitationCreateSchema.parse(body));
  }

  @Post(':invitationId/resend')
  @RequireRole('owner')
  resend(
    @Req() request: HouseholdRequest,
    @Param('invitationId') invitationId: string,
  ): Promise<InvitationCreated> {
    return this.invitations.resend(membershipOf(request), invitationId);
  }

  @Delete(':invitationId')
  @RequireRole('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Req() request: HouseholdRequest,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(membershipOf(request), invitationId);
  }
}
