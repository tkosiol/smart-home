import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  gatewayPairingCreateSchema,
  gatewayPairingRedeemSchema,
  type GatewayPairing,
  type GatewayPairingRedeemed,
} from '@smart/contracts';
import { Public, RateLimit, SkipOriginCheck } from '../../../platform/http/index.js';
import {
  HouseholdGuard,
  membershipOf,
  RequireRole,
  type HouseholdRequest,
} from '../../households/index.js';
import { PairingService } from './pairing.service.js';

/** Owners create the codes that pair Home Assistant with their household. */
@Controller('v1/households/:householdId/gateway-pairings')
@UseGuards(HouseholdGuard)
export class GatewayPairingsController {
  constructor(private readonly pairing: PairingService) {}

  @Post()
  @RequireRole('owner')
  @RateLimit('gatewayPairingCreatePerIp')
  create(@Req() request: HouseholdRequest, @Body() body: unknown): Promise<GatewayPairing> {
    const membership = membershipOf(request);
    return this.pairing.create(
      membership.householdId,
      membership.userId,
      gatewayPairingCreateSchema.parse(body),
    );
  }
}

/**
 * Home Assistant redeems a code here. The code in the body is the only authorisation: no cookie,
 * no session, so no Origin check either (spec 5.2). The answer carries the gateway's key.
 */
@Controller('v1/gateway-pairing')
export class GatewayPairingRedeemController {
  constructor(private readonly pairing: PairingService) {}

  @Public()
  @SkipOriginCheck()
  @RateLimit('gatewayPairingRedeemPerIp')
  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  redeem(@Body() body: unknown): Promise<GatewayPairingRedeemed> {
    return this.pairing.redeem(gatewayPairingRedeemSchema.parse(body));
  }
}
