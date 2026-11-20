import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Gateway, GatewayKind, GatewayRegister } from '@smart/contracts';
import { ENV, type Env } from '../../platform/config/index.js';
import { describeError } from '../../platform/errors/index.js';
import { ApiError } from '../../platform/http/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { CLOCK, type Clock } from '../identity/index.js';
import { GatewayCredentials, reasonOf } from './credentials/gateway-credentials.service.js';
import { readGatewayCertificate } from './gateway-certificate.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GATEWAY_TOUCHED,
  GatewayEvents,
  type GatewayRegistered,
  type GatewayRevoked,
  type GatewayTouched,
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
  kind: GatewayKind;
  topicPrefix: string;
}

/** A gateway with the time it was registered (internal: not part of the public contract). */
export type RegisteredGateway = Gateway & { registeredAt: Date };

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
    private readonly adapters: AdapterRegistry,
    private readonly credentials: GatewayCredentials,
  ) {}

  async list(householdId: string): Promise<Gateway[]> {
    return (await this.householdGateways(householdId)).map(({ gateway }) => gateway);
  }

  /** `list`, each with the time it was registered (for callers inside the backend). */
  async listRegistered(householdId: string): Promise<RegisteredGateway[]> {
    return (await this.householdGateways(householdId)).map(({ row, gateway }) => ({
      ...gateway,
      registeredAt: row.createdAt,
    }));
  }

  private async householdGateways(
    householdId: string,
  ): Promise<{ row: GatewayRow; gateway: Gateway }[]> {
    const rows = await this.gateways.listByHousehold(householdId);
    const now = this.clock();
    // The CRL concerns certificates only: without a gateway that has one, there is nothing to warn about.
    const crlNextUpdate = rows.some((row) => row.auth === 'certificate')
      ? await this.crlNextUpdate()
      : undefined;
    return rows.map((row) => ({ row, gateway: this.toGateway(row, crlNextUpdate, now) }));
  }

  /** The gateway with the household it belongs to, revoked or not; `undefined` if unknown. */
  async find(gatewayId: string): Promise<{ householdId: string; gateway: Gateway } | undefined> {
    const row = await this.gateways.findById(gatewayId);
    if (!row) return undefined;
    const crlNextUpdate = row.auth === 'certificate' ? await this.crlNextUpdate() : undefined;
    return {
      householdId: row.householdId,
      gateway: this.toGateway(row, crlNextUpdate, this.clock()),
    };
  }

  /** Registers the gateway whose public certificate was pasted; the CA decides whether it counts. */
  async register(householdId: string, input: GatewayRegister): Promise<Gateway> {
    const kind = input.kind ?? 'z2m';
    // No adapter, nobody could follow the gateway: refused before anything is stored. A gateway
    // of the kind ha has no certificate: it pairs with a code instead.
    if (kind !== 'z2m' || this.adapters.get(kind) === undefined) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'validation.failed');
    }
    const ca = await this.loadCa();
    const now = this.clock();
    const certificate = readGatewayCertificate(input.certificate, ca, now);
    const recalled = this.recallFor(certificate.id, kind);
    const heard = recalled?.bridge !== undefined || recalled?.service !== undefined;
    const inserted = await this.gateways.insert({
      id: certificate.id,
      householdId,
      name: input.name,
      kind,
      topicPrefix: `gw/${certificate.id}/${kind}`,
      certFingerprint: certificate.fingerprint,
      certExpiresAt: certificate.expiresAt,
      createdAt: now,
      ...(recalled?.bridge && { bridgeStatus: recalled.bridge }),
      ...(recalled?.service && { serviceStatus: recalled.service }),
      ...(heard && { statusChangedAt: recalled.at ?? now }),
    });
    // The same message whether the ID is taken in this or another household.
    if (!inserted) throw new ApiError(HttpStatus.CONFLICT, 'gateway.exists');
    const row = await this.applyLateStatus(inserted, recalled, now);
    const registered: GatewayRegistered = {
      gatewayId: row.id,
      kind: row.kind,
      topicPrefix: row.topicPrefix,
    };
    this.events.emit(GATEWAY_REGISTERED, registered);
    return this.toGateway(row, await this.crlNextUpdate(), now);
  }

  /** What the memory holds for the ID; a service status heard from another kind of gateway says nothing about this one. */
  private recallFor(id: string, kind: GatewayKind): RecalledStatus | undefined {
    const recalled = this.memory.recall(id);
    if (recalled?.service === undefined || recalled.serviceKind === kind) return recalled;
    return {
      ...(recalled.bridge && { bridge: recalled.bridge }),
      ...(recalled.at && { at: recalled.at }),
    };
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
    const latest = this.recallFor(row.id, row.kind);
    let result = row;
    for (const kind of ['bridge', 'service'] as const) {
      const status = latest?.[kind];
      if (status === undefined || status === (recalled?.[kind] ?? 'unknown')) continue;
      await this.gateways.applyStatus(row.id, kind, status, now, row.kind);
      result = {
        ...result,
        ...(kind === 'bridge' ? { bridgeStatus: status } : { serviceStatus: status }),
        statusChangedAt: now,
      };
    }
    return result;
  }

  /**
   * Revokes a gateway of the household. Credentials access is the owner's to revoke (the caller has
   * checked the role); a certificate also sits on the CRL, which only a platform admin can issue.
   */
  async revoke(householdId: string, id: string, actor: { platformAdmin: boolean }): Promise<void> {
    const gateway = await this.gateways.findById(id);
    if (gateway?.householdId !== householdId) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    }
    if (gateway.auth === 'certificate' && !actor.platformAdmin) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'auth.forbidden');
    }
    const revoked = await this.gateways.revoke(householdId, id, this.clock());
    if (!revoked) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    if (gateway.auth === 'credentials') await this.removeBrokerUser(id);
    const event: GatewayRevoked = { gatewayId: id };
    this.events.emit(GATEWAY_REVOKED, event);
  }

  /**
   * Deletes the revoked gateway's broker user, which disconnects it at once. A failure is only
   * logged: the next reconcile deletes the user of a revoked gateway anyway.
   */
  private async removeBrokerUser(id: string): Promise<void> {
    try {
      await this.credentials.exclusive(() => this.credentials.remove(id));
    } catch (error) {
      this.logger.warn(
        `Revoked ${id}, but its broker user is still there (${reasonOf(error)}); the reconcile retries`,
      );
    }
  }

  /** The gateways that are registered and not revoked, with the topic prefix they publish under. */
  async listActive(): Promise<ActiveGateway[]> {
    const rows = await this.gateways.listActive();
    return rows.map((row) => ({
      id: row.id,
      householdId: row.householdId,
      kind: row.kind,
      topicPrefix: row.topicPrefix,
    }));
  }

  /**
   * Records that the gateway showed a sign of life and announces it; `false` (and no announcement)
   * if it is not registered or was revoked. The caller keeps it to about once a minute.
   */
  async touch(gatewayId: string, now: Date): Promise<boolean> {
    if (!(await this.gateways.touch(gatewayId, now))) return false;
    const event: GatewayTouched = { gatewayId };
    this.events.emit(GATEWAY_TOUCHED, event);
    return true;
  }

  private toGateway(row: GatewayRow, crlNextUpdate: Date | undefined, now: Date): Gateway {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      auth: row.auth,
      topicPrefix: row.topicPrefix,
      bridgeStatus: row.bridgeStatus,
      serviceStatus: row.serviceStatus,
      statusChangedAt: iso(row.statusChangedAt),
      lastMessageAt: iso(row.lastMessageAt),
      certExpiresAt: iso(row.certExpiresAt),
      credentialGeneration: row.credentialGeneration,
      revokedAt: iso(row.revokedAt),
      // A revoked gateway's certificate is no concern any more; the CRL still is. Credentials
      // have neither.
      warnings:
        row.auth === 'certificate' && row.certExpiresAt
          ? gatewayWarnings(row.certExpiresAt, crlNextUpdate, now).filter(
              (warning) => row.revokedAt === null || warning === 'crlExpiring',
            )
          : [],
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
