import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lt, or } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { describeError, stackFrames } from '../../platform/errors/index.js';
import { CLOCK, type Clock } from './clock.js';
import { emailLoginCodes, sessions } from './identity.schema.js';

const RETENTION_MS = 30 * 86_400_000;

@Injectable()
export class CleanupJob {
  private readonly logger = new Logger(CleanupJob.name);

  constructor(
    @Inject(DATABASE) private readonly connection: DatabaseConnection,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Cron('30 3 * * *', { name: 'identity-cleanup', timeZone: 'UTC' })
  async runScheduled(): Promise<void> {
    try {
      const removed = await this.run();
      this.logger.log(`Removed ${removed.sessions} sessions and ${removed.codes} login codes`);
    } catch (error) {
      this.logger.error(`Identity cleanup failed: ${describeError(error)}`, stackFrames(error));
    }
  }

  /** Deletes expired login codes and sessions that expired or were revoked over 30 days ago. */
  async run(): Promise<{ sessions: number; codes: number }> {
    const now = this.clock();
    const cutoff = new Date(now.getTime() - RETENTION_MS);
    const { db } = this.connection;
    const removedSessions = await db
      .delete(sessions)
      .where(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)))
      .returning({ id: sessions.id });
    const removedCodes = await db
      .delete(emailLoginCodes)
      .where(lt(emailLoginCodes.expiresAt, now))
      .returning({ id: emailLoginCodes.id });
    return { sessions: removedSessions.length, codes: removedCodes.length };
  }
}
