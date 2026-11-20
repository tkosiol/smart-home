import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { describeError, stackFrames } from '../../../platform/errors/index.js';
import { CLOCK, type Clock } from '../../identity/index.js';
import { GatewayPairingsRepository } from './gateway-pairings.repository.js';

const RETENTION_MS = 7 * 86_400_000;

@Injectable()
export class PairingCleanupJob {
  private readonly logger = new Logger(PairingCleanupJob.name);

  constructor(
    private readonly pairings: GatewayPairingsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Cron('50 3 * * *', { name: 'gateway-pairings-cleanup', timeZone: 'UTC' })
  async runScheduled(): Promise<void> {
    try {
      this.logger.log(`Removed ${String(await this.run())} settled pairing codes`);
    } catch (error) {
      this.logger.error(`Pairing code cleanup failed: ${describeError(error)}`, stackFrames(error));
    }
  }

  /** Deletes pairing codes that were redeemed or expired over 7 days ago. */
  run(): Promise<number> {
    return this.pairings.deleteSettledBefore(new Date(this.clock().getTime() - RETENTION_MS));
  }
}
