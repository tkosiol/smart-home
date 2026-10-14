import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from './clock.js';
import type { AuthMethod } from './identity.schema.js';
import { newToken, sha256 } from './secrets.js';
import { SessionsRepository } from './sessions.repository.js';

const DAY_MS = 86_400_000;
/** Sliding lifetime of a session (spec 3.4). */
export const SESSION_IDLE_MS = 30 * DAY_MS;
/** Hard limit counted from creation, regardless of activity. */
export const SESSION_ABSOLUTE_MS = 180 * DAY_MS;
/** `last_seen_at` and `expires_at` are written at most once per interval. */
const REFRESH_AFTER_MS = 60_000;
const USER_AGENT_MAX_LENGTH = 255;

export interface ValidSession {
  userId: string;
  sessionId: string;
  /** True when this call extended the session; the cookie then needs to be renewed. */
  refreshed: boolean;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Returns the raw token (for the cookie); only its hash is stored. */
  async create(
    userId: string,
    authMethod: AuthMethod,
    userAgent: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = this.clock();
    const token = newToken();
    const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
    await this.sessions.insert({
      tokenHash: sha256(token),
      userId,
      authMethod,
      userAgent: userAgent.slice(0, USER_AGENT_MAX_LENGTH),
      now,
      expiresAt,
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    });
    return { token, expiresAt };
  }

  async validate(token: string): Promise<ValidSession | null> {
    const session = await this.sessions.findByTokenHash(sha256(token));
    if (!session || session.revokedAt) return null;
    const now = this.clock();
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) return null;

    const base = { userId: session.userId, sessionId: session.id };
    if (now.getTime() - session.lastSeenAt.getTime() <= REFRESH_AFTER_MS) {
      return { ...base, refreshed: false, expiresAt: session.expiresAt };
    }
    const expiresAt = new Date(
      Math.min(now.getTime() + SESSION_IDLE_MS, session.absoluteExpiresAt.getTime()),
    );
    await this.sessions.touch(session.id, now, expiresAt);
    return { ...base, refreshed: true, expiresAt };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, this.clock());
  }
}
