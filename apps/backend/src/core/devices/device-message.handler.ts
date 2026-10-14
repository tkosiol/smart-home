import { Injectable, Logger } from '@nestjs/common';
import type { Capability } from '@smart/contracts';
import { Throttle } from '../gateways/index.js';
import { MeasurementWriter, type NewMeasurementRow } from '../telemetry/index.js';
import type { DeviceMessageHandler } from './device-message-handler.js';
import { DevicesRepository } from './devices.repository.js';
import { HardwareRepository } from './hardware.repository.js';
import { measurementTime } from './measurement-time.js';

const HOUR_MS = 3_600_000;
const MEMORY_LIMIT = 1000;
const MAX_TEXT_LENGTH = 1000;
const MAX_COMPOSITE_LENGTH = 2000;
/** What Zigbee2MQTT calls the on and off of switches and lights. */
const ON = 'ON';
const OFF = 'OFF';

/** Postgres cannot store a NUL character in text or jsonb (as a value or as a key). */
const hasNul = (text: string): boolean => text.includes('\u0000');
const MAX_COMPOSITE_DEPTH = 5;

/** Whether a NUL is in any key or string of the value; anything nested deeper is no composite. */
function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return hasNul(value);
  if (typeof value !== 'object' || value === null) return false;
  if (depth >= MAX_COMPOSITE_DEPTH) return true;
  const entries = Array.isArray(value)
    ? value.map((item): [string, unknown] => ['', item])
    : Object.entries(value);
  return entries.some(([key, item]) => hasNul(key) || containsNul(item, depth + 1));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether `value` is something the capability can carry. */
function isValid(capability: Capability, value: unknown): boolean {
  switch (capability.kind) {
    case 'numeric':
      return typeof value === 'number' && Number.isFinite(value);
    case 'binary':
      return typeof value === 'boolean' || value === ON || value === OFF;
    case 'enum':
      return typeof value === 'string' && (capability.enumValues ?? []).includes(value);
    case 'text':
      return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH && !hasNul(value);
    case 'composite': {
      if (!isPlainObject(value)) return false;
      return JSON.stringify(value).length <= MAX_COMPOSITE_LENGTH && !containsNul(value);
    }
  }
}

/** The value columns of a valid value; `undefined` for kinds that are no readings. */
function readingOf(
  capability: Capability,
  value: unknown,
): Pick<NewMeasurementRow, 'valueNum' | 'valueText'> | undefined {
  switch (capability.kind) {
    case 'numeric':
      return { valueNum: value as number };
    case 'binary':
      return { valueNum: value === true || value === ON ? 1 : 0 };
    case 'enum':
      return { valueText: value as string };
    // Text and composite values are only ever kept in the state.
    case 'text':
    case 'composite':
      return undefined;
  }
}

/**
 * Turns the messages of hardware into state and readings: checks each field against what the
 * hardware's capabilities allow (and drops the rest), keeps the hardware's last state, and for
 * hardware that sits in a device also the device's state and its readings. Readings take the time
 * the hardware reports (when plausible); state only moves forward in that time, so a late
 * delivery never overwrites a newer state. Values are never logged.
 */
@Injectable()
export class DeviceMessageProcessor implements DeviceMessageHandler {
  private readonly logger = new Logger(DeviceMessageProcessor.name);
  private readonly notices = new Throttle(HOUR_MS, MEMORY_LIMIT);

  /** Fields thrown away since start because their value does not fit the capability. */
  discardedFields = 0;

  constructor(
    private readonly hardware: HardwareRepository,
    private readonly devices: DevicesRepository,
    private readonly writer: MeasurementWriter,
  ) {}

  async handle(
    gatewayId: string,
    hardwareId: string,
    payload: Record<string, unknown>,
    receivedAt: Date,
    retained: boolean,
  ): Promise<void> {
    const { time, replaced } = measurementTime(payload['last_seen'], receivedAt);
    // A retained copy is what the broker replays on subscribing, not something heard now: it only
    // counts with a time of its own (checked against what is stored below).
    if (retained && replaced) return;

    const capabilities = await this.hardware.capabilitiesOf(hardwareId);
    const { state, rejected } = this.validate(payload, capabilities);
    if (rejected > 0) this.noteRejected(gatewayId, rejected, receivedAt);

    const recorded = await this.hardware.recordState(hardwareId, state, time, {
      strictlyNewer: retained,
    });
    if (retained && !recorded) return;

    const binding = await this.devices.activeBindingForHardware(hardwareId);
    if (!binding) return;
    await this.devices.recordState(binding.deviceId, state, time);

    const rows: NewMeasurementRow[] = [];
    for (const capability of capabilities) {
      if (!capability.readable || capability.isSetting || !(capability.key in state)) continue;
      const reading = readingOf(capability, state[capability.key]);
      if (reading) {
        rows.push({
          time,
          deviceId: binding.deviceId,
          capability: capability.key,
          ...reading,
          flags: replaced ? ['time_replaced'] : [],
        });
      }
    }
    this.writer.add(rows);
  }

  /**
   * The fields of the message that are published properties of the hardware with a fitting value;
   * `rejected` counts the ones whose value does not fit. Other keys (`last_seen`, `update`, …) are
   * no capabilities and are left out without being counted.
   */
  private validate(
    payload: Record<string, unknown>,
    capabilities: readonly Capability[],
  ): { state: Record<string, unknown>; rejected: number } {
    const state: Record<string, unknown> = {};
    let rejected = 0;
    for (const capability of capabilities) {
      if (!capability.readable || !Object.hasOwn(payload, capability.key)) continue;
      const value = payload[capability.key];
      if (isValid(capability, value)) state[capability.key] = value;
      else rejected += 1;
    }
    return { state, rejected };
  }

  private noteRejected(gatewayId: string, count: number, now: Date): void {
    this.discardedFields += count;
    if (this.notices.allow(gatewayId, now)) {
      this.logger.warn(
        `Dropped ${count} field(s) whose value does not fit the capability from messages of ${gatewayId}`,
      );
    }
  }
}
