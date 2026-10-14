import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GatewayEvents,
  type GatewaysService,
} from '../gateways/index.js';
import type { MqttConnection, MqttMessageHandler } from '../../platform/mqtt/index.js';
import type { DeviceMessageHandler } from './device-message-handler.js';
import { DeviceIngestConsumer } from './device-ingest.consumer.js';
import type { HardwareRepository, Z2mDevice } from './hardware.repository.js';

const T0 = new Date('2026-10-14T12:00:00Z');
const GW = 'gw-a1b2c3d4';
const OTHER = 'gw-e5f6a7b8';
const prefix = (id: string): string => `gw/${id}/z2m`;

const fixture = readFileSync(
  new URL('../../../../gateway-simulator/fixtures/devices.json', import.meta.url),
  'utf8',
);

const fixtureDevices = JSON.parse(fixture) as Record<string, unknown>[];

/** Like a broker: delivers a message to the handlers whose filter matches. */
class FakeMqtt {
  readonly handlers: { filter: string; handler: MqttMessageHandler }[] = [];
  readonly unsubscribed: string[] = [];

  subscribe(filter: string, handler: MqttMessageHandler): () => void {
    const entry = { filter, handler };
    this.handlers.push(entry);
    return () => {
      this.handlers.splice(this.handlers.indexOf(entry), 1);
      this.unsubscribed.push(filter);
    };
  }

  get filters(): string[] {
    return this.handlers.map((entry) => entry.filter);
  }

  publish(topic: string, payload: string | Buffer, retained = false): void {
    const levels = topic.split('/');
    for (const { filter, handler } of [...this.handlers]) {
      const pattern = filter.split('/');
      const hash = pattern.at(-1) === '#';
      const fixed = hash ? pattern.slice(0, -1) : pattern;
      const matches =
        (hash ? levels.length >= fixed.length : levels.length === fixed.length) &&
        fixed.every((level, index) => level === '+' || level === levels[index]);
      if (matches) handler(topic, Buffer.from(payload), retained);
    }
  }
}

describe('DeviceIngestConsumer', () => {
  let now: Date;
  let mqtt: FakeMqtt;
  let events: GatewayEvents;
  let active: { id: string; topicPrefix: string }[];
  let stored: Map<string, { id: string; friendlyName: string }[]>;
  let consumer: DeviceIngestConsumer;
  const upsertFromBridge = vi.fn<HardwareRepository['upsertFromBridge']>();
  const listNames = vi.fn<HardwareRepository['listNames']>();
  const recordJoined = vi.fn<HardwareRepository['recordJoined']>();
  const setInterviewState = vi.fn<HardwareRepository['setInterviewState']>();
  const markLeft = vi.fn<HardwareRepository['markLeft']>();
  const rename = vi.fn<HardwareRepository['rename']>();
  const setAvailability = vi.fn<HardwareRepository['setAvailability']>();
  const handle = vi.fn<DeviceMessageHandler['handle']>();
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const logged = (): string => [...log.mock.calls, ...warn.mock.calls].map(String).join('\n');

  const send = async (topic: string, payload: unknown, retained = false): Promise<void> => {
    mqtt.publish(
      topic,
      typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload),
      retained,
    );
    await consumer.idle();
  };

  const start = async (): Promise<void> => {
    consumer.onModuleInit();
    await consumer.idle();
  };

  beforeEach(() => {
    now = T0;
    mqtt = new FakeMqtt();
    events = new GatewayEvents();
    active = [{ id: GW, topicPrefix: prefix(GW) }];
    stored = new Map();
    for (const mock of [
      upsertFromBridge,
      listNames,
      recordJoined,
      setInterviewState,
      markLeft,
      rename,
      setAvailability,
      handle,
    ]) {
      mock.mockReset();
    }
    upsertFromBridge.mockResolvedValue({ upserted: 0, removed: 0 });
    // After an upsert the database holds the listed devices under ids `h-<ieee>`.
    listNames.mockImplementation((gatewayId) => Promise.resolve(stored.get(gatewayId) ?? []));
    upsertFromBridge.mockImplementation((gatewayId, devices: readonly Z2mDevice[]) => {
      stored.set(
        gatewayId,
        devices.map((device) => ({
          id: `${gatewayId}:${device.ieeeAddress}`,
          friendlyName: device.friendlyName,
        })),
      );
      return Promise.resolve({ upserted: devices.length, removed: 0 });
    });
    recordJoined.mockResolvedValue('h-joined');
    setInterviewState.mockResolvedValue();
    markLeft.mockResolvedValue(undefined);
    rename.mockResolvedValue(undefined);
    setAvailability.mockResolvedValue();
    handle.mockResolvedValue();
    log.mockClear();
    warn.mockClear();
    consumer = new DeviceIngestConsumer(
      { listActive: () => Promise.resolve(active) } as unknown as GatewaysService,
      events,
      {
        upsertFromBridge,
        listNames,
        recordJoined,
        setInterviewState,
        markLeft,
        rename,
        setAvailability,
      } as unknown as HardwareRepository,
      { handle },
      mqtt as unknown as MqttConnection,
      () => now,
    );
  });

  afterEach(() => {
    consumer.onModuleDestroy();
  });

  describe('subscriptions', () => {
    it('subscribes to the prefix of every active gateway on start', async () => {
      active = [
        { id: GW, topicPrefix: prefix(GW) },
        { id: OTHER, topicPrefix: prefix(OTHER) },
      ];
      await start();
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`, `${prefix(OTHER)}/#`]);
    });

    it('subscribes to a gateway that is registered later and ends it when it is revoked', async () => {
      await start();
      active.push({ id: OTHER, topicPrefix: prefix(OTHER) });
      events.emit(GATEWAY_REGISTERED, { gatewayId: OTHER, topicPrefix: prefix(OTHER) });
      await consumer.idle();
      expect(mqtt.filters).toContain(`${prefix(OTHER)}/#`);

      events.emit(GATEWAY_REVOKED, { gatewayId: OTHER });
      await consumer.idle();
      expect(mqtt.unsubscribed).toEqual([`${prefix(OTHER)}/#`]);
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
    });

    it('tries again when the database is not there on start', async () => {
      vi.useFakeTimers();
      try {
        const listActive = vi
          .fn<GatewaysService['listActive']>()
          .mockRejectedValueOnce(new Error('relation "gateways" does not exist'))
          .mockResolvedValue(active);
        consumer = new DeviceIngestConsumer(
          { listActive } as unknown as GatewaysService,
          events,
          { listNames } as unknown as HardwareRepository,
          { handle },
          mqtt as unknown as MqttConnection,
          () => now,
        );
        consumer.onModuleInit();
        await consumer.idle();
        expect(mqtt.filters).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5000);
        await consumer.idle();
        expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not try again after it was destroyed', async () => {
      vi.useFakeTimers();
      try {
        const listActive = vi.fn<GatewaysService['listActive']>().mockRejectedValue(new Error('x'));
        consumer = new DeviceIngestConsumer(
          { listActive } as unknown as GatewaysService,
          events,
          { listNames } as unknown as HardwareRepository,
          { handle },
          mqtt as unknown as MqttConnection,
          () => now,
        );
        consumer.onModuleInit();
        await consumer.idle();
        consumer.onModuleDestroy();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(listActive).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('subscribes once when a gateway is announced twice', async () => {
      await start();
      for (let n = 0; n < 2; n += 1) {
        events.emit(GATEWAY_REGISTERED, { gatewayId: GW, topicPrefix: prefix(GW) });
      }
      await consumer.idle();
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
    });

    it('stops handling the messages that a revoked gateway already had queued', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      mqtt.publish(`${prefix(GW)}/Lampe`, '{"state":"ON"}');
      events.emit(GATEWAY_REVOKED, { gatewayId: GW });
      await consumer.idle();
      expect(handle).not.toHaveBeenCalled();
    });

    it('does not subscribe to a gateway that is revoked while its names are loading', async () => {
      await start();
      let release: (names: { id: string; friendlyName: string }[]) => void = () => undefined;
      listNames.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      events.emit(GATEWAY_REGISTERED, { gatewayId: OTHER, topicPrefix: prefix(OTHER) });
      events.emit(GATEWAY_REVOKED, { gatewayId: OTHER });
      release([]);
      await consumer.idle();
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
    });

    it('takes the names from the database on start', async () => {
      stored.set(GW, [{ id: 'h-lamp', friendlyName: 'Lampe' }]);
      await start();
      await send(`${prefix(GW)}/Lampe`, { state: 'ON' });
      expect(handle).toHaveBeenCalledWith(GW, 'h-lamp', { state: 'ON' }, T0);
    });
  });

  describe('bridge/devices', () => {
    it('stores the listed devices without the coordinator, with their capabilities', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture), true);
      expect(upsertFromBridge).toHaveBeenCalledTimes(1);
      const [gatewayId, devices, at] = upsertFromBridge.mock.calls[0] ?? [];
      expect(gatewayId).toBe(GW);
      expect(at).toEqual(T0);
      expect(devices).toHaveLength(7);
      const lamp = devices?.find((device) => device.friendlyName === 'Lampe');
      expect(lamp).toMatchObject({
        ieeeAddress: '0x00000000000000a7',
        vendor: 'IKEA',
        model: 'LED1624G9',
        interviewState: 'SUCCESSFUL',
      });
      expect(lamp?.capabilities.map((capability) => capability.key)).toContain('brightness');
      expect(lamp?.definition).toMatchObject({ model: 'LED1624G9' });
      const plant = devices?.find((device) => device.friendlyName === 'Pflanze 1');
      expect(
        plant?.capabilities.find((capability) => capability.key === 'soil_warning')?.isSetting,
      ).toBe(true);
    });

    it('keeps a device without a definition, with no capabilities', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, [
        {
          ieee_address: '0x00000000000000b1',
          friendly_name: 'mystery',
          type: 'EndDevice',
          interview_state: 'FAILED',
          definition: null,
          manufacturer: 'ACME',
          model_id: 'X-1',
        },
      ]);
      expect(upsertFromBridge.mock.calls[0]?.[1]).toEqual([
        {
          ieeeAddress: '0x00000000000000b1',
          friendlyName: 'mystery',
          vendor: 'ACME',
          model: 'X-1',
          description: null,
          definition: {},
          interviewState: 'FAILED',
          capabilities: [],
        },
      ]);
    });

    it('maps a name to the hardware after the list was stored', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      await send(`${prefix(GW)}/Pflanze 1`, { soil_moisture: 41 });
      expect(handle).toHaveBeenCalledWith(
        GW,
        `${GW}:0x00000000000000a1`,
        { soil_moisture: 41 },
        T0,
      );
    });

    it('drops names that the bridge no longer lists', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      const rest = (JSON.parse(fixture) as { friendly_name: string }[]).filter(
        (device) => device.friendly_name !== 'Lampe',
      );
      await send(`${prefix(GW)}/bridge/devices`, rest);
      await send(`${prefix(GW)}/Lampe`, { state: 'ON' });
      expect(handle).not.toHaveBeenCalled();
    });

    it.each([
      ['no JSON', 'not json'],
      ['not a list', '{"a":1}'],
      ['an entry without an address', '[{"friendly_name":"x"}]'],
      ['an address that is none', '[{"ieee_address":"nope","friendly_name":"x"}]'],
    ])('stores nothing and survives %s', async (_label, payload) => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, payload);
      expect(upsertFromBridge).not.toHaveBeenCalled();
      await send(`${prefix(GW)}/bridge/devices`, fixture);
      expect(upsertFromBridge).toHaveBeenCalledTimes(1);
    });

    it('ignores a list that is far bigger than any real one', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, Buffer.alloc(5 * 1024 * 1024, 0x20));
      expect(upsertFromBridge).not.toHaveBeenCalled();
    });

    it('keeps the hardware of two gateways with the same name apart', async () => {
      active.push({ id: OTHER, topicPrefix: prefix(OTHER) });
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      await send(`${prefix(OTHER)}/bridge/devices`, JSON.parse(fixture));
      await send(`${prefix(GW)}/Lampe`, { state: 'ON' });
      await send(`${prefix(OTHER)}/Lampe`, { state: 'OFF' });
      expect(handle.mock.calls.map(([gateway, hardware]) => [gateway, hardware])).toEqual([
        [GW, `${GW}:0x00000000000000a7`],
        [OTHER, `${OTHER}:0x00000000000000a7`],
      ]);
    });
  });

  describe('device messages', () => {
    beforeEach(async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
    });

    it('hands the parsed message over with the time it was received', async () => {
      now = new Date('2026-10-14T12:30:00Z');
      await send(`${prefix(GW)}/Pflanze 2`, { soil_moisture: 12, battery: 90 });
      expect(handle).toHaveBeenCalledWith(
        GW,
        `${GW}:0x00000000000000a2`,
        { soil_moisture: 12, battery: 90 },
        now,
      );
    });

    it('finds hardware whose name contains slashes', async () => {
      await send(`${prefix(GW)}/bridge/devices`, [
        { ...fixtureDevices[7], friendly_name: 'living room/lamp' },
      ]);
      await send(`${prefix(GW)}/living room/lamp`, { state: 'ON' });
      expect(handle).toHaveBeenCalledTimes(1);
    });

    it('ignores command topics without counting them', async () => {
      await send(`${prefix(GW)}/Lampe/set`, { state: 'ON' });
      await send(`${prefix(GW)}/Lampe/set/brightness`, '100');
      await send(`${prefix(GW)}/Lampe/get`, '');
      await send(`${prefix(GW)}/bridge/request/permit_join`, '{}');
      await send(`${prefix(GW)}/bridge/state`, 'online');
      expect(handle).not.toHaveBeenCalled();
      expect(consumer.discarded).toEqual({ unknownName: 0, invalid: 0 });
    });

    it('counts a message under an unknown name and logs it once an hour per name', async () => {
      await send(`${prefix(GW)}/ghost`, { secret: 'payload-value' });
      await send(`${prefix(GW)}/ghost`, { secret: 'payload-value' });
      await send(`${prefix(GW)}/other ghost`, { secret: 'payload-value' });
      expect(handle).not.toHaveBeenCalled();
      expect(consumer.discarded.unknownName).toBe(3);
      expect(log.mock.calls.length + warn.mock.calls.length).toBe(2);
      expect(logged()).toContain('ghost');
      expect(logged()).not.toContain('payload-value');
      now = new Date(T0.getTime() + 3_600_001);
      await send(`${prefix(GW)}/ghost`, { secret: 'payload-value' });
      expect(log.mock.calls.length + warn.mock.calls.length).toBe(3);
    });

    it('discards a message that is no JSON object, without logging it', async () => {
      await send(`${prefix(GW)}/Lampe`, 'ON');
      await send(`${prefix(GW)}/Lampe`, '[1,2]');
      await send(`${prefix(GW)}/Lampe`, Buffer.alloc(100_000, 0x20));
      expect(handle).not.toHaveBeenCalled();
      expect(consumer.discarded.invalid).toBe(3);
      expect(logged()).not.toContain('ON');
    });

    it('goes on after the handler failed', async () => {
      handle.mockRejectedValueOnce(new Error('payload-value'));
      await send(`${prefix(GW)}/Lampe`, { state: 'ON' });
      await send(`${prefix(GW)}/Lampe`, { state: 'OFF' });
      expect(handle).toHaveBeenCalledTimes(2);
      expect(logged()).not.toContain('payload-value');
    });
  });

  describe('bridge/event', () => {
    beforeEach(async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
    });

    it('follows a rename: the new name leads to the hardware, the old one is discarded', async () => {
      rename.mockResolvedValue(`${GW}:0x00000000000000a7`);
      await send(`${prefix(GW)}/bridge/event`, {
        type: 'device_renamed',
        data: { from: 'Lampe', to: 'Stehlampe', homeassistant_rename: false },
      });
      expect(rename).toHaveBeenCalledWith(GW, 'Lampe', 'Stehlampe');
      await send(`${prefix(GW)}/Stehlampe`, { state: 'ON' });
      expect(handle).toHaveBeenCalledWith(GW, `${GW}:0x00000000000000a7`, { state: 'ON' }, T0);
      await send(`${prefix(GW)}/Lampe`, { state: 'OFF' });
      expect(handle).toHaveBeenCalledTimes(1);
      expect(consumer.discarded.unknownName).toBe(1);
    });

    it('adds hardware that joined', async () => {
      await send(`${prefix(GW)}/bridge/event`, {
        type: 'device_joined',
        data: { friendly_name: '0x00000000000000c1', ieee_address: '0x00000000000000c1' },
      });
      expect(recordJoined).toHaveBeenCalledWith(GW, '0x00000000000000c1', '0x00000000000000c1', T0);
      await send(`${prefix(GW)}/0x00000000000000c1`, { battery: 80 });
      expect(handle).toHaveBeenCalledWith(GW, 'h-joined', { battery: 80 }, T0);
    });

    it.each([
      ['started', 'IN_PROGRESS'],
      ['successful', 'SUCCESSFUL'],
      ['failed', 'FAILED'],
    ])('stores the interview status %s', async (status, state) => {
      await send(`${prefix(GW)}/bridge/event`, {
        type: 'device_interview',
        data: { friendly_name: 'Lampe', ieee_address: '0x00000000000000a7', status },
      });
      expect(setInterviewState).toHaveBeenCalledWith(GW, '0x00000000000000a7', state);
    });

    it('marks hardware that left as removed and discards its name', async () => {
      markLeft.mockResolvedValue({ id: `${GW}:0x00000000000000a7`, friendlyName: 'Lampe' });
      await send(`${prefix(GW)}/bridge/event`, {
        type: 'device_leave',
        data: { friendly_name: 'Lampe', ieee_address: '0x00000000000000a7' },
      });
      expect(markLeft).toHaveBeenCalledWith(GW, '0x00000000000000a7', T0);
      await send(`${prefix(GW)}/Lampe`, { state: 'ON' });
      expect(handle).not.toHaveBeenCalled();
    });

    it('ignores other events and events that are malformed', async () => {
      await send(`${prefix(GW)}/bridge/event`, { type: 'device_announce', data: {} });
      await send(`${prefix(GW)}/bridge/event`, { type: 'device_renamed', data: { from: 1 } });
      await send(`${prefix(GW)}/bridge/event`, 'garbage');
      expect(rename).not.toHaveBeenCalled();
      expect(recordJoined).not.toHaveBeenCalled();
      expect(setInterviewState).not.toHaveBeenCalled();
    });
  });

  describe('availability', () => {
    beforeEach(async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
    });

    it.each([
      ['{"state":"online"}', 'online'],
      ['{"state":"offline"}', 'offline'],
      ['online', 'online'],
      ['offline', 'offline'],
    ])('reads %s', async (payload, availability) => {
      await send(`${prefix(GW)}/Pflanze 3/availability`, payload);
      expect(setAvailability).toHaveBeenCalledWith(`${GW}:0x00000000000000a3`, availability);
    });

    it('ignores a payload that is neither', async () => {
      await send(`${prefix(GW)}/Pflanze 3/availability`, '{"state":"sleeping"}');
      await send(`${prefix(GW)}/Pflanze 3/availability`, 'maybe');
      expect(setAvailability).not.toHaveBeenCalled();
    });

    it('applies an availability that arrived before the device list', async () => {
      active.push({ id: OTHER, topicPrefix: prefix(OTHER) });
      events.emit(GATEWAY_REGISTERED, { gatewayId: OTHER, topicPrefix: prefix(OTHER) });
      await consumer.idle();
      await send(`${prefix(OTHER)}/Lampe/availability`, '{"state":"online"}', true);
      expect(setAvailability).not.toHaveBeenCalled();
      await send(`${prefix(OTHER)}/bridge/devices`, JSON.parse(fixture), true);
      expect(setAvailability).toHaveBeenCalledWith(`${OTHER}:0x00000000000000a7`, 'online');
    });
  });
});
