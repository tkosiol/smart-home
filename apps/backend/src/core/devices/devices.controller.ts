import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  deviceCreateSchema,
  deviceRenameSchema,
  type Device,
  type Hardware,
} from '@smart/contracts';
import * as z from 'zod';
import {
  HouseholdGuard,
  membershipOf,
  RequireRole,
  type HouseholdRequest,
} from '../households/index.js';
import { DevicesService } from './devices.service.js';

/** Only unassigned hardware can be listed; the parameter leaves room for other views. */
const hardwareQuerySchema = z.object({ state: z.literal('unassigned') });

@Controller('v1/households/:householdId')
@UseGuards(HouseholdGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get('hardware')
  @RequireRole('owner')
  listHardware(@Req() request: HouseholdRequest, @Query() query: unknown): Promise<Hardware[]> {
    hardwareQuerySchema.parse(query);
    return this.devices.listUnassignedHardware(membershipOf(request).householdId);
  }

  @Post('devices')
  @RequireRole('owner')
  create(@Req() request: HouseholdRequest, @Body() body: unknown): Promise<Device> {
    return this.devices.create(membershipOf(request).householdId, deviceCreateSchema.parse(body));
  }

  @Get('devices')
  @RequireRole('viewer')
  list(@Req() request: HouseholdRequest): Promise<Device[]> {
    return this.devices.list(membershipOf(request).householdId);
  }

  @Get('devices/:deviceId')
  @RequireRole('viewer')
  get(@Req() request: HouseholdRequest, @Param('deviceId') deviceId: string): Promise<Device> {
    return this.devices.get(membershipOf(request).householdId, deviceId);
  }

  @Patch('devices/:deviceId')
  @RequireRole('member')
  rename(
    @Req() request: HouseholdRequest,
    @Param('deviceId') deviceId: string,
    @Body() body: unknown,
  ): Promise<Device> {
    return this.devices.rename(
      membershipOf(request).householdId,
      deviceId,
      deviceRenameSchema.parse(body),
    );
  }
}
