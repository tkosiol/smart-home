import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { emailLoginCodes } from './identity.schema.js';

export type EmailLoginCode = typeof emailLoginCodes.$inferSelect;

export interface NewLoginCode {
  codeHash: string;
  browserNonceHash: string;
  expiresAt: Date;
}

/** At most `max` codes per e-mail within `windowMs` before `now`. */
export interface IssueLimit {
  now: Date;
  windowMs: number;
  max: number;
}

export type IssueResult = { issued: true } | { issued: false; retryAt: Date };

@Injectable()
export class EmailLoginRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /**
   * Invalidates the open codes of `email` and stores the new one, unless `limit` is reached. Runs
   * under a per-address advisory lock so concurrent requests cannot exceed the limit.
   */
  replaceOpen(email: string, code: NewLoginCode, limit: IssueLimit): Promise<IssueResult> {
    const { now, windowMs, max } = limit;
    return this.connection.db.transaction(async (tx): Promise<IssueResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
      const recent = await tx
        .select({ createdAt: emailLoginCodes.createdAt })
        .from(emailLoginCodes)
        .where(
          and(
            eq(emailLoginCodes.email, email),
            gt(emailLoginCodes.createdAt, new Date(now.getTime() - windowMs)),
          ),
        )
        .orderBy(asc(emailLoginCodes.createdAt));
      // The oldest of the latest `max` codes decides when the next one is allowed.
      const blocking = recent.length >= max ? recent[recent.length - max] : undefined;
      if (blocking)
        return { issued: false, retryAt: new Date(blocking.createdAt.getTime() + windowMs) };

      await tx
        .update(emailLoginCodes)
        .set({ usedAt: now })
        .where(and(eq(emailLoginCodes.email, email), isNull(emailLoginCodes.usedAt)));
      await tx.insert(emailLoginCodes).values({ email, ...code, createdAt: now });
      return { issued: true };
    });
  }

  /** The newest code of `email` that is not used (and not replaced) yet. */
  async findOpen(email: string): Promise<EmailLoginCode | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(emailLoginCodes)
      .where(and(eq(emailLoginCodes.email, email), isNull(emailLoginCodes.usedAt)))
      .orderBy(desc(emailLoginCodes.createdAt))
      .limit(1);
    return row;
  }

  /** Counts a wrong guess; returns the new count, or undefined when `maxAttempts` was reached. */
  async recordFailedAttempt(id: string, maxAttempts: number): Promise<number | undefined> {
    const [row] = await this.connection.db
      .update(emailLoginCodes)
      .set({ attempts: sql`${emailLoginCodes.attempts} + 1` })
      .where(
        and(
          eq(emailLoginCodes.id, id),
          isNull(emailLoginCodes.usedAt),
          lt(emailLoginCodes.attempts, maxAttempts),
        ),
      )
      .returning({ attempts: emailLoginCodes.attempts });
    return row?.attempts;
  }

  /** Atomically consumes a code; false when it was used, replaced, expired or locked meanwhile. */
  async markUsed(id: string, now: Date, maxAttempts: number): Promise<boolean> {
    const rows = await this.connection.db
      .update(emailLoginCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailLoginCodes.id, id),
          isNull(emailLoginCodes.usedAt),
          gt(emailLoginCodes.expiresAt, now),
          lt(emailLoginCodes.attempts, maxAttempts),
        ),
      )
      .returning({ id: emailLoginCodes.id });
    return rows.length === 1;
  }
}
