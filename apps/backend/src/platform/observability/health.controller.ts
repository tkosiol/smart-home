import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthLiveResponse, HealthReadyResponse } from '@smart/contracts';
import { ReadinessService } from './readiness.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('live')
  live(): HealthLiveResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<HealthReadyResponse> {
    const result = await this.readiness.check();
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
