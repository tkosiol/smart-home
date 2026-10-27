import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { hasRole, type HouseholdRole, type LiveEventType } from '@smart/contracts';
import { describeError } from '../../platform/errors/index.js';
import { MembershipsRepository } from '../households/index.js';
import { SessionService, UsersRepository } from '../identity/index.js';
import { LIVE_OPTIONS, type LiveOptions } from './live.options.js';
import { SSE_PING, sseEvent } from './sse.js';

export interface Audience {
  role: HouseholdRole;
  isPlatformAdmin: boolean;
}

export interface LiveClient {
  householdId: string;
  userId: string;
  sessionId: string;
  audience: Audience;
  /** Writes to the response; false when its buffer is full. */
  write(chunk: string): boolean;
  /** Ends the response; called at most once by the hub. */
  close(): void;
}

/**
 * The open event streams, per household. Writing never blocks: a client whose buffer is full or
 * whose socket is gone is closed and dropped. A timer pings every stream and checks that its
 * session is still active and its user still a member, so a removed member stops receiving.
 */
@Injectable()
export class LiveHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveHub.name);
  private readonly clients = new Map<string, Set<LiveClient>>();
  private timer: NodeJS.Timeout | undefined;
  private beating = false;

  constructor(
    private readonly sessions: SessionService,
    private readonly memberships: MembershipsRepository,
    private readonly users: UsersRepository,
    @Inject(LIVE_OPTIONS) private readonly options: LiveOptions,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.heartbeat().catch((error: unknown) => {
        this.logger.warn(`Live heartbeat failed: ${describeError(error)}`);
      });
    }, this.options.heartbeatMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    for (const set of [...this.clients.values()]) for (const client of [...set]) this.drop(client);
  }

  /** Registers the client; returns the function that unregisters it. */
  add(client: LiveClient): () => void {
    let set = this.clients.get(client.householdId);
    if (!set) this.clients.set(client.householdId, (set = new Set()));
    set.add(client);
    return () => this.remove(client);
  }

  watching(householdId: string): boolean {
    return (this.clients.get(householdId)?.size ?? 0) > 0;
  }

  publish(householdId: string, type: LiveEventType, data: unknown, minRole: HouseholdRole): void {
    const frame = sseEvent(type, data);
    for (const client of this.snapshot(householdId)) {
      if (hasRole(client.audience.role, minRole)) this.send(client, frame);
    }
  }

  /** Builds once per distinct audience among the household's clients. */
  publishByAudience(
    householdId: string,
    type: LiveEventType,
    build: (audience: Audience) => unknown,
  ): void {
    const frames = new Map<string, string | undefined>();
    for (const client of this.snapshot(householdId)) {
      const { role, isPlatformAdmin } = client.audience;
      const key = `${role}:${isPlatformAdmin}`;
      if (!frames.has(key)) {
        try {
          frames.set(key, sseEvent(type, build({ role, isPlatformAdmin })));
        } catch (error) {
          this.logger.warn(`Cannot build a live event for an audience: ${describeError(error)}`);
          frames.set(key, undefined);
        }
      }
      const frame = frames.get(key);
      if (frame !== undefined) this.send(client, frame);
    }
  }

  /** Pings every client and checks session and membership (also run by the timer). */
  async heartbeat(): Promise<void> {
    if (this.beating) return;
    this.beating = true;
    try {
      for (const set of [...this.clients.values()]) {
        for (const client of [...set]) await this.beat(client);
      }
    } finally {
      this.beating = false;
    }
  }

  private async beat(client: LiveClient): Promise<void> {
    if (!this.send(client, SSE_PING)) return;
    try {
      const [active, membership, user] = await Promise.all([
        this.sessions.isActive(client.sessionId),
        this.memberships.find(client.householdId, client.userId),
        this.users.findById(client.userId),
      ]);
      if (!this.has(client)) return;
      if (!active || !membership) {
        this.drop(client);
        return;
      }
      client.audience = { role: membership.role, isPlatformAdmin: user?.isPlatformAdmin ?? false };
    } catch (error) {
      // Not closing on a failed check: the next heartbeat looks again.
      this.logger.warn(`Cannot check a live stream: ${describeError(error)}`);
    }
  }

  private snapshot(householdId: string): LiveClient[] {
    return [...(this.clients.get(householdId) ?? [])];
  }

  private has(client: LiveClient): boolean {
    return this.clients.get(client.householdId)?.has(client) ?? false;
  }

  /** Writes to a registered client; a full buffer or a failing write closes it. */
  private send(client: LiveClient, frame: string): boolean {
    if (!this.has(client)) return false;
    let ok: boolean;
    try {
      ok = client.write(frame);
    } catch {
      ok = false;
    }
    if (!ok) this.drop(client);
    return ok;
  }

  private remove(client: LiveClient): boolean {
    const set = this.clients.get(client.householdId);
    if (!set?.delete(client)) return false;
    if (set.size === 0) this.clients.delete(client.householdId);
    return true;
  }

  /** Removes the client and ends its response, once. */
  private drop(client: LiveClient): void {
    if (!this.remove(client)) return;
    try {
      client.close();
    } catch (error) {
      this.logger.warn(`Cannot close a live stream: ${describeError(error)}`);
    }
  }
}
