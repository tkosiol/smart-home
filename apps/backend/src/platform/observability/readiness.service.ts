import { Injectable } from '@nestjs/common';
import type { HealthReadyResponse } from '@smart/contracts';
import { DatabaseHealth } from '../database/index.js';
import { MqttHealth } from '../mqtt/index.js';

@Injectable()
export class ReadinessService {
  constructor(
    private readonly database: DatabaseHealth,
    private readonly broker: MqttHealth,
  ) {}

  async check(): Promise<HealthReadyResponse> {
    const database = await this.database.check();
    const broker = this.broker.check();
    const status = database === 'up' && broker === 'up' ? 'ok' : 'unavailable';
    return { status, checks: { database, broker } };
  }
}
