import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  currentHouseholdUpdateSchema,
  householdCreateSchema,
  householdUpdateSchema,
  overviewLayoutSchema,
  type HouseholdSummary,
  type Me,
  type OverviewLayout,
} from '@smart/contracts';
import type { Response } from 'express';
import { ApiError } from '../../platform/http/index.js';
import {
  type AuthenticatedUser,
  CurrentUser,
  MeService,
  UsersRepository,
} from '../identity/index.js';
import { HouseholdGuard, membershipOf, type HouseholdRequest } from './household.guard.js';
import { HouseholdsRepository } from './households.repository.js';
import { isUuid } from './is-uuid.js';
import { MembershipsRepository } from './memberships.repository.js';
import { RequireRole } from './require-role.decorator.js';

/** Routes of the signed-in user that are not scoped to one household. */
@Controller('v1')
export class HouseholdsController {
  constructor(
    private readonly households: HouseholdsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly users: UsersRepository,
    private readonly meService: MeService,
  ) {}

  @Post('households')
  async create(@CurrentUser() current: AuthenticatedUser, @Body() body: unknown): Promise<Me> {
    const input = householdCreateSchema.parse(body);
    await this.households.createWithOwner(current.id, input);
    return this.meOf(current.id);
  }

  /** Selects the current household; lives here because it checks the membership. */
  @Put('me')
  async selectCurrent(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<Me> {
    const { householdId } = currentHouseholdUpdateSchema.parse(body);
    const membership = isUuid(householdId)
      ? await this.memberships.find(householdId, current.id)
      : undefined;
    if (!membership) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    const user = await this.users.setLastHousehold(current.id, householdId);
    if (!user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    return this.meService.forUser(user);
  }

  private async meOf(userId: string): Promise<Me> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    return this.meService.forUser(user);
  }
}

@Controller('v1/households/:householdId')
@UseGuards(HouseholdGuard)
export class HouseholdController {
  constructor(private readonly households: HouseholdsRepository) {}

  @Patch()
  @RequireRole('owner')
  async update(@Req() request: HouseholdRequest, @Body() body: unknown): Promise<HouseholdSummary> {
    const update = householdUpdateSchema.parse(body);
    const membership = membershipOf(request);
    const household = await this.households.update(membership.householdId, update);
    if (!household) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    const { id, name, timezone } = household;
    return { id, name, timezone, role: membership.role };
  }
}

/** The signed-in member's own settings in one household; any role may change them. */
@Controller('v1/households/:householdId/me')
@UseGuards(HouseholdGuard)
export class HouseholdMeController {
  constructor(private readonly memberships: MembershipsRepository) {}

  /** The stored layout, or JSON `null`: the app normalises it against its known blocks. */
  @Get('overview-layout')
  @RequireRole('viewer')
  overviewLayout(@Req() request: HouseholdRequest, @Res() response: Response): void {
    response.json(membershipOf(request).overviewLayout);
  }

  @Put('overview-layout')
  @RequireRole('viewer')
  async saveOverviewLayout(
    @Req() request: HouseholdRequest,
    @Body() body: unknown,
  ): Promise<OverviewLayout> {
    const layout = overviewLayoutSchema.parse(body);
    await this.store(request, layout);
    return layout;
  }

  @Delete('overview-layout')
  @RequireRole('viewer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetOverviewLayout(@Req() request: HouseholdRequest): Promise<void> {
    await this.store(request, null);
  }

  private async store(request: HouseholdRequest, layout: OverviewLayout | null): Promise<void> {
    const { householdId, userId } = membershipOf(request);
    // The membership may have been removed since the guard looked it up.
    if (!(await this.memberships.setOverviewLayout(householdId, userId, layout))) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    }
  }
}
