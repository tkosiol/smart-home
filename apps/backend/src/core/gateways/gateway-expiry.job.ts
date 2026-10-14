import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { describeError, stackFrames } from '../../platform/errors/index.js';
import { CLOCK, type Clock } from '../identity/index.js';
import { crlExpiring, gatewayWarnings } from './gateway-warnings.js';
import { GatewaysRepository } from './gateways.repository.js';
import { GatewaysService } from './gateways.service.js';

export interface ExpiryReport {
  certificates: { id: string; expiresAt: Date; expired: boolean }[];
  crlExpiring: boolean;
}

/** Logs, once a day, which gateway certificates and the CRL need renewing soon. */
@Injectable()
export class GatewayExpiryJob {
  private readonly logger = new Logger(GatewayExpiryJob.name);

  constructor(
    private readonly repository: GatewaysRepository,
    private readonly service: GatewaysService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Cron('0 4 * * *', { name: 'gateways-expiry', timeZone: 'UTC' })
  async runScheduled(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Gateway expiry check failed: ${describeError(error)}`, stackFrames(error));
    }
  }

  async run(): Promise<ExpiryReport> {
    const now = this.clock();
    const certificates: ExpiryReport['certificates'] = [];
    for (const gateway of await this.repository.listActive()) {
      const warnings = gatewayWarnings(gateway.certExpiresAt, undefined, now);
      const expired = warnings.includes('certExpired');
      if (!expired && !warnings.includes('certExpiring')) continue;
      certificates.push({ id: gateway.id, expiresAt: gateway.certExpiresAt, expired });
      this.logger.warn(
        `The certificate of gateway ${gateway.id} ${expired ? 'expired' : 'expires'} on ` +
          gateway.certExpiresAt.toISOString(),
      );
    }
    const crlNextUpdate = await this.service.crlNextUpdate();
    const expiring = crlExpiring(crlNextUpdate, now);
    if (crlNextUpdate === undefined) {
      this.logger.warn('The CRL renewal date is not available, so its expiry cannot be checked');
    } else if (expiring) {
      this.logger.warn(`The CRL must be renewed by ${crlNextUpdate.toISOString()}`);
    }
    return { certificates, crlExpiring: expiring };
  }
}
