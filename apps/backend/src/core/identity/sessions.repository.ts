import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { sessions, type AuthMethod, type Session } from './identity.schema.js';

export interface NewSession {
  tokenHash: string;
  userId: string;
  authMethod: AuthMethod;
  userAgent: string;
  now: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  async insert(input: NewSession): Promise<void> {
    await this.connection.db.insert(sessions).values({
      tokenHash: input.tokenHash,
      userId: input.userId,
      authMethod: input.authMethod,
      userAgent: input.userAgent,
      createdAt: input.now,
      lastSeenAt: input.now,
      expiresAt: input.expiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    return row;
  }

  async touch(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    await this.connection.db
      .update(sessions)
      .set({ lastSeenAt, expiresAt })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.connection.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  /** Revokes the user's sessions that are still open; returns how many that were. */
  async revokeAllForUser(userId: string, at: Date): Promise<number> {
    const rows = await this.connection.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  }
}
