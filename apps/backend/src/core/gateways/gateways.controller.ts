import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { gatewayRegisterSchema, type Gateway } from '@smart/contracts';
import {
  HouseholdGuard,
  membershipOf,
  RequireRole,
  type HouseholdRequest,
} from '../households/index.js';
import { RequirePlatformAdmin } from '../identity/index.js';
import { GatewaysService } from './gateways.service.js';

/** Owners see the gateways of their household; platform admins register and revoke them. */
@Controller('v1/households/:householdId/gateways')
@UseGuards(HouseholdGuard)
export class GatewaysController {
  constructor(private readonly gateways: GatewaysService) {}

  @Get()
  @RequireRole('owner')
  list(@Req() request: HouseholdRequest): Promise<Gateway[]> {
    return this.gateways.list(membershipOf(request).householdId);
  }

  @Post()
  @RequireRole('owner')
  @RequirePlatformAdmin()
  register(@Req() request: HouseholdRequest, @Body() body: unknown): Promise<Gateway> {
    return this.gateways.register(
      membershipOf(request).householdId,
      gatewayRegisterSchema.parse(body),
    );
  }

  @Post(':gatewayId/revoke')
  @RequireRole('owner')
  @RequirePlatformAdmin()
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Req() request: HouseholdRequest, @Param('gatewayId') gatewayId: string): Promise<void> {
    return this.gateways.revoke(membershipOf(request).householdId, gatewayId);
  }
}
