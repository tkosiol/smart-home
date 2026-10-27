import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type DeviceHistory,
  type HistoryQuery,
  type HistoryRange,
  type HistoryResolution,
} from '@smart/contracts';
import { ApiError } from '../../platform/http/index.js';
import { HouseholdsRepository } from '../households/index.js';
import { HistoryRepository } from '../telemetry/index.js';
import { DevicesService } from './devices.service.js';

const HOUR_MS = 3_600_000;
const RANGES: Record<HistoryRange, { hours: number; resolution: HistoryResolution }> = {
  '24h': { hours: 24, resolution: '15m' },
  '7d': { hours: 7 * 24, resolution: '1h' },
  '28d': { hours: 28 * 24, resolution: '1h' },
};

/** Numeric measurement histories of a device: buckets, and for 28 days also calendar days. */
@Injectable()
export class DeviceHistoryService {
  constructor(
    private readonly devices: DevicesService,
    private readonly history: HistoryRepository,
    private readonly households: HouseholdsRepository,
  ) {}

  async get(
    householdId: string,
    deviceId: string,
    query: HistoryQuery,
    now: Date = new Date(),
  ): Promise<DeviceHistory> {
    // Throws the same 404 for unknown and foreign devices.
    const device = await this.devices.get(householdId, deviceId);
    // `capabilities` holds readable capabilities without settings.
    const capability = device.capabilities.find((c) => c.key === query.capability);
    if (!capability || capability.kind !== 'numeric') {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'validation.failed');
    }
    const { hours, resolution } = RANGES[query.range];
    const to = now;
    const from = new Date(to.getTime() - hours * HOUR_MS);
    const points = await this.history.points(deviceId, capability.key, from, to, resolution);
    let days: DeviceHistory['days'] = [];
    if (query.range === '28d') {
      const household = await this.households.findById(householdId);
      if (!household) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
      days = await this.history.days(deviceId, capability.key, from, to, household.timezone);
    }
    return {
      capability: capability.key,
      unit: capability.unit,
      range: query.range,
      resolution,
      from: from.toISOString(),
      to: to.toISOString(),
      points,
      days,
    };
  }
}
