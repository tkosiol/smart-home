import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { describeError, stackFrames } from '../../platform/errors/index.js';
import { CLOCK, type Clock } from '../identity/index.js';
import { InvitationsRepository } from './invitations.repository.js';

const RETENTION_MS = 30 * 86_400_000;

@Injectable()
export class HouseholdsCleanupJob {
  private readonly logger = new Logger(HouseholdsCleanupJob.name);

  constructor(
    private readonly invitations: InvitationsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Cron('45 3 * * *', { name: 'households-cleanup', timeZone: 'UTC' })
  async runScheduled(): Promise<void> {
    try {
      this.logger.log(`Removed ${await this.run()} settled invitations`);
    } catch (error) {
      this.logger.error(`Household cleanup failed: ${describeError(error)}`, stackFrames(error));
    }
  }

  /** Deletes invitations that expired, were revoked or accepted over 30 days ago. */
  run(): Promise<number> {
    return this.invitations.deleteSettledBefore(new Date(this.clock().getTime() - RETENTION_MS));
  }
}
