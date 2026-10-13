import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { memberRoleUpdateSchema, type Member } from '@smart/contracts';
import { HouseholdGuard, membershipOf, type HouseholdRequest } from './household.guard.js';
import { MembersService } from './members.service.js';
import { RequireRole } from './require-role.decorator.js';

@Controller('v1/households/:householdId/members')
@UseGuards(HouseholdGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequireRole('viewer')
  list(@Req() request: HouseholdRequest): Promise<Member[]> {
    return this.members.list(membershipOf(request).householdId);
  }

  @Patch(':userId')
  @RequireRole('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeRole(
    @Req() request: HouseholdRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { role } = memberRoleUpdateSchema.parse(body);
    await this.members.change(membershipOf(request), userId, role);
  }

  /** Viewer is enough for the route: everyone may leave; removing others needs owner. */
  @Delete(':userId')
  @RequireRole('viewer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() request: HouseholdRequest, @Param('userId') userId: string): Promise<void> {
    await this.members.change(membershipOf(request), userId, 'removed');
  }
}
