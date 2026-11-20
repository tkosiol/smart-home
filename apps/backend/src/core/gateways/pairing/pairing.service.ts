import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  DISPLAY_NAME_MAX_LENGTH,
  displayNameSchema,
  type GatewayPairing,
  type GatewayPairingCreate,
  type GatewayPairingRedeem,
  type GatewayPairingRedeemed,
} from '@smart/contracts';
import { ENV, type Env } from '../../../platform/config/index.js';
import { ApiError } from '../../../platform/http/index.js';
import { CLOCK, type Clock } from '../../identity/index.js';
import { GatewayCredentials, reasonOf } from '../credentials/gateway-credentials.service.js';
import { gatewayClientId } from '../credentials/password.js';
import { GATEWAY_REGISTERED, GatewayEvents, type GatewayRegistered } from '../gateway-events.js';
import { GatewaysRepository } from '../gateways.repository.js';
import {
  GatewayPairingsRepository,
  type PairingTransaction,
} from './gateway-pairings.repository.js';
import {
  hashPairingCode,
  newGatewayId,
  newPairingCode,
  normalizePairingCode,
} from './pairing-code.js';

export const PAIRING_TTL_MS = 15 * 60_000;
/** Non-revoked `credentials` gateways a household may have (spec 5.5). */
export const MAX_PAIRED_GATEWAYS = 5;
/** A drawn gateway ID may be taken (40 bits): so many draws before giving up. */
const ID_ATTEMPTS = 5;
const DEFAULT_NAME = 'Home Assistant';

/** What a redeem changed, known once its transaction has committed. */
interface Redeemed {
  gatewayId: string;
  generation: number;
  /** Set for a new gateway: what to announce. */
  registered?: GatewayRegistered;
}

const invalid = (): ApiError => new ApiError(HttpStatus.NOT_FOUND, 'gateway.pairingInvalid');
const unavailable = (): ApiError =>
  new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'gateway.pairingUnavailable');
const limitReached = (): ApiError => new ApiError(HttpStatus.CONFLICT, 'gateway.limitReached');

/**
 * Pairs Home Assistant with a code (spec 4.1, 4.2, 5.2): an owner creates the code, the
 * integration redeems it for a new gateway with credentials access, or for the next key of an
 * existing one. Codes and keys are never logged; only a code's hash is stored.
 */
@Injectable()
export class PairingService {
  private readonly logger = new Logger(PairingService.name);

  constructor(
    private readonly pairings: GatewayPairingsRepository,
    private readonly gateways: GatewaysRepository,
    private readonly credentials: GatewayCredentials,
    private readonly events: GatewayEvents,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(
    householdId: string,
    userId: string,
    input: GatewayPairingCreate,
  ): Promise<GatewayPairing> {
    const gatewayId = input.gatewayId ?? null;
    if (gatewayId !== null) {
      const gateway = await this.gateways.findById(gatewayId);
      const pairable =
        gateway?.householdId === householdId &&
        gateway.auth === 'credentials' &&
        gateway.revokedAt === null;
      if (!pairable) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    } else if ((await this.gateways.countActiveCredentials(householdId)) >= MAX_PAIRED_GATEWAYS) {
      throw limitReached();
    }
    // Without the secret no code could ever be redeemed: say so now, not in Home Assistant.
    if (!this.credentials.enabled) throw unavailable();
    const code = newPairingCode();
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    await this.pairings.replaceOpen({
      householdId,
      gatewayId,
      codeHash: hashPairingCode(code.replace('-', '')),
      createdBy: userId,
      now,
      expiresAt,
    });
    return { code, expiresAt: expiresAt.toISOString(), appUrl: this.env.APP_ORIGIN };
  }

  /**
   * One step under the credentials' lock: the transaction (code locked, gateway written, code
   * used), the broker step and the commit. A reconcile in between would read the database before
   * the commit and undo the broker step. The lock also makes redeems run one at a time, so the
   * limit cannot be passed by redeeming two codes at once.
   */
  async redeem(input: GatewayPairingRedeem): Promise<GatewayPairingRedeemed> {
    const normalized = normalizePairingCode(input.code);
    if (normalized === undefined) throw invalid();
    if (!this.credentials.enabled) throw unavailable();
    const codeHash = hashPairingCode(normalized);
    const redeemed = await this.credentials.exclusive(() =>
      this.pairings.transaction((tx) => this.redeemIn(tx, codeHash, input)),
    );
    if (redeemed.registered) this.events.emit(GATEWAY_REGISTERED, redeemed.registered);
    const { gatewayId, generation } = redeemed;
    return {
      gatewayId,
      mqttUrl: `${this.env.APP_ORIGIN.replace(/^http/, 'ws')}/mqtt`,
      username: gatewayId,
      password: this.credentials.password(gatewayId, generation),
      clientId: gatewayClientId(gatewayId),
    };
  }

  /** Throws to roll back: the code then stays valid. */
  private async redeemIn(
    tx: PairingTransaction,
    codeHash: string,
    input: GatewayPairingRedeem,
  ): Promise<Redeemed> {
    const now = this.clock();
    const pairing = await this.pairings.lockOpen(tx, codeHash, now);
    if (!pairing) throw invalid();
    if (input.expectedGatewayId !== undefined && input.expectedGatewayId !== pairing.gatewayId) {
      throw new ApiError(HttpStatus.CONFLICT, 'gateway.pairingOtherGateway');
    }
    let redeemed: Redeemed;
    if (pairing.gatewayId === null) {
      if (
        (await this.gateways.countActiveCredentials(pairing.householdId, tx)) >= MAX_PAIRED_GATEWAYS
      ) {
        throw limitReached();
      }
      const gatewayId = await this.insertGateway(
        tx,
        pairing.householdId,
        gatewayNameOf(input.name),
        now,
      );
      redeemed = {
        gatewayId,
        generation: 1,
        registered: { gatewayId, kind: 'ha', topicPrefix: topicPrefixOf(gatewayId) },
      };
    } else {
      // Revoked since the code was made: the code went with it.
      const generation = await this.gateways.nextGeneration(tx, pairing.gatewayId);
      if (generation === undefined) throw invalid();
      redeemed = { gatewayId: pairing.gatewayId, generation };
    }
    await this.pairings.markUsed(tx, pairing.id, now);
    await this.brokerStep(redeemed);
    return redeemed;
  }

  private async insertGateway(
    tx: PairingTransaction,
    householdId: string,
    name: string,
    now: Date,
  ): Promise<string> {
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
      const id = newGatewayId();
      const inserted = await this.gateways.insert(
        {
          id,
          householdId,
          name,
          kind: 'ha',
          auth: 'credentials',
          credentialGeneration: 1,
          topicPrefix: topicPrefixOf(id),
          createdAt: now,
        },
        tx,
      );
      if (inserted) return id;
    }
    throw new Error(`no free gateway ID after ${String(ID_ATTEMPTS)} attempts`);
  }

  /** The last step of the transaction: when the broker does not confirm, nothing is stored. */
  private async brokerStep({ gatewayId, generation, registered }: Redeemed): Promise<void> {
    try {
      if (registered) await this.credentials.create(gatewayId, generation);
      else await this.credentials.rekey(gatewayId, generation);
    } catch (error) {
      this.logger.warn(
        `Pairing ${gatewayId} failed at the broker (${reasonOf(error)}); nothing was stored`,
      );
      throw unavailable();
    }
  }
}

const topicPrefixOf = (gatewayId: string): string => `gw/${gatewayId}/ha`;

const isControl = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
};

/**
 * Home Assistant's location name as a gateway name: without control characters, trimmed, cut to
 * the display name length between characters (never within one), else "Home Assistant". An odd
 * location name must not fail the pairing.
 */
function gatewayNameOf(locationName: string | undefined): string {
  const visible = [...(locationName ?? '')]
    .filter((char) => !isControl(char))
    .join('')
    .trim();
  let name = '';
  for (const char of visible) {
    if (name.length + char.length > DISPLAY_NAME_MAX_LENGTH) break;
    name += char;
  }
  name = name.trimEnd();
  return displayNameSchema.safeParse(name).success ? name : DEFAULT_NAME;
}
