import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Gateway, GatewayRegister } from '@smart/contracts';
import { ENV, type Env } from '../../platform/config/index.js';
import { describeError } from '../../platform/errors/index.js';
import { ApiError } from '../../platform/http/index.js';
import { CLOCK, type Clock } from '../identity/index.js';
import { readGatewayCertificate } from './gateway-certificate.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GatewayEvents,
  type GatewayRegistered,
  type GatewayRevoked,
} from './gateway-events.js';
import {
  GATEWAY_STATUS_MEMORY,
  type GatewayStatusMemory,
  type RecalledStatus,
} from './gateway-status-memory.js';
import { gatewayWarnings } from './gateway-warnings.js';
import { GatewaysRepository } from './gateways.repository.js';
import type { GatewayRow } from './gateways.schema.js';

const HOUR_MS = 3_600_000;

export interface ActiveGateway {
  id: string;
  householdId: string;
  topicPrefix: string;
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

@Injectable()
export class GatewaysService {
  private readonly logger = new Logger(GatewaysService.name);
  private lastCrlWarning = 0;

  constructor(
    private readonly gateways: GatewaysRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(GATEWAY_STATUS_MEMORY) private readonly memory: GatewayStatusMemory,
    private readonly events: GatewayEvents,
  ) {}

  async list(householdId: string): Promise<Gateway[]> {
    const rows = await this.gateways.listByHousehold(householdId);
    const now = this.clock();
    const crlNextUpdate = rows.length > 0 ? await this.crlNextUpdate() : undefined;
    return rows.map((row) => this.toGateway(row, crlNextUpdate, now));
  }

  /** Registers the gateway whose public certificate was pasted; the CA decides whether it counts. */
  async register(householdId: string, input: GatewayRegister): Promise<Gateway> {
    const ca = await this.loadCa();
    const now = this.clock();
    const certificate = readGatewayCertificate(input.certificate, ca, now);
    const recalled = this.memory.recall(certificate.id);
    const heard = recalled?.bridge !== undefined || recalled?.z2m !== undefined;
    const inserted = await this.gateways.insert({
      id: certificate.id,
      householdId,
      name: input.name,
      topicPrefix: `gw/${certificate.id}/z2m`,
      certFingerprint: certificate.fingerprint,
      certExpiresAt: certificate.expiresAt,
      createdAt: now,
      ...(recalled?.bridge && { bridgeStatus: recalled.bridge }),
      ...(recalled?.z2m && { z2mStatus: recalled.z2m }),
      ...(heard && { statusChangedAt: recalled.at ?? now }),
    });
    // The same message whether the ID is taken in this or another household.
    if (!inserted) throw new ApiError(HttpStatus.CONFLICT, 'gateway.exists');
    const row = await this.applyLateStatus(inserted, recalled, now);
    const registered: GatewayRegistered = { gatewayId: row.id, topicPrefix: row.topicPrefix };
    this.events.emit(GATEWAY_REGISTERED, registered);
    return this.toGateway(row, await this.crlNextUpdate(), now);
  }

  /**
   * A status that arrived between the recall and the insert was not applied by the consumer (the
   * gateway did not exist yet): apply what the memory holds now when it differs from the insert.
   */
  private async applyLateStatus(
    row: GatewayRow,
    recalled: RecalledStatus | undefined,
    now: Date,
  ): Promise<GatewayRow> {
    const latest = this.memory.recall(row.id);
    let result = row;
    for (const kind of ['bridge', 'z2m'] as const) {
      const status = latest?.[kind];
      if (status === undefined || status === (recalled?.[kind] ?? 'unknown')) continue;
      await this.gateways.applyStatus(row.id, kind, status, now);
      result = {
        ...result,
        ...(kind === 'bridge' ? { bridgeStatus: status } : { z2mStatus: status }),
        statusChangedAt: now,
      };
    }
    return result;
  }

  async revoke(householdId: string, id: string): Promise<void> {
    const revoked = await this.gateways.revoke(householdId, id, this.clock());
    if (!revoked) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    const event: GatewayRevoked = { gatewayId: id };
    this.events.emit(GATEWAY_REVOKED, event);
  }

  /** The gateways that are registered and not revoked, with the topic prefix they publish under. */
  async listActive(): Promise<ActiveGateway[]> {
    const rows = await this.gateways.listActive();
    return rows.map((row) => ({
      id: row.id,
      householdId: row.householdId,
      topicPrefix: row.topicPrefix,
    }));
  }

  private toGateway(row: GatewayRow, crlNextUpdate: Date | undefined, now: Date): Gateway {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      topicPrefix: row.topicPrefix,
      bridgeStatus: row.bridgeStatus,
      z2mStatus: row.z2mStatus,
      statusChangedAt: iso(row.statusChangedAt),
      lastMessageAt: iso(row.lastMessageAt),
      certExpiresAt: row.certExpiresAt.toISOString(),
      revokedAt: iso(row.revokedAt),
      // A revoked gateway's certificate is no concern any more; the CRL still is.
      warnings: gatewayWarnings(row.certExpiresAt, crlNextUpdate, now).filter(
        (warning) => row.revokedAt === null || warning === 'crlExpiring',
      ),
    };
  }

  /** The mounted CA certificate, read on every use so that a renewed CA needs no restart. */
  private async loadCa(): Promise<X509Certificate> {
    const file = this.env.GATEWAY_CA_FILE;
    if (!file) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'gateway.caMissing');
    try {
      return new X509Certificate(await readFile(file));
    } catch (error) {
      this.logger.warn(`Cannot read the gateway CA certificate: ${describeError(error)}`);
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'gateway.caMissing');
    }
  }

  /** When the CRL must be renewed (written by `pki.sh`); without the file there is no warning. */
  async crlNextUpdate(): Promise<Date | undefined> {
    const file = this.env.GATEWAY_CRL_NEXT_UPDATE_FILE;
    if (!file) return undefined;
    try {
      const date = new Date((await readFile(file, 'utf8')).trim());
      if (!Number.isNaN(date.getTime())) return date;
      this.warnAboutCrl('the content is not a date');
    } catch (error) {
      this.warnAboutCrl(describeError(error));
    }
    return undefined;
  }

  /** The CRL warning would silently disappear with a broken file: say so, at most once an hour. */
  private warnAboutCrl(reason: string): void {
    const now = this.clock().getTime();
    if (now - this.lastCrlWarning < HOUR_MS) return;
    this.lastCrlWarning = now;
    this.logger.warn(`Cannot read the CRL renewal date (GATEWAY_CRL_NEXT_UPDATE_FILE): ${reason}`);
  }
}
