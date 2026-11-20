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
import { RequirePlatformAdmin, UsersRepository } from '../identity/index.js';
import { GatewaysService } from './gateways.service.js';

/** Owners see the gateways of their household and revoke those with credentials; platform admins register and revoke the others. */
@Controller('v1/households/:householdId/gateways')
@UseGuards(HouseholdGuard)
export class GatewaysController {
  constructor(
    private readonly gateways: GatewaysService,
    private readonly users: UsersRepository,
  ) {}

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
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Req() request: HouseholdRequest,
    @Param('gatewayId') gatewayId: string,
  ): Promise<void> {
    // The service decides whether the gateway's access kind needs a platform admin.
    const user = request.user ? await this.users.findById(request.user.id) : undefined;
    await this.gateways.revoke(membershipOf(request).householdId, gatewayId, {
      platformAdmin: user?.isPlatformAdmin ?? false,
    });
  }
}
