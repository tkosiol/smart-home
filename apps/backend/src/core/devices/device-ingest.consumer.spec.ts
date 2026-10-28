import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GatewayEvents,
  type ActiveGateway,
  type GatewaysService,
} from '../gateways/index.js';
import type {
  MqttConnection,
  MqttMessageHandler,
  SubscribeOptions,
  Unsubscribe,
} from '../../platform/mqtt/index.js';
import type { NameMap } from './name-map.js';
import type { DeviceMessageHandler } from './device-message-handler.js';
import { DEVICE_CHANGED, DeviceEvents, HARDWARE_CHANGED } from './device-events.js';
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
  readonly options: (SubscribeOptions | undefined)[] = [];
  readonly unsubscribed: string[] = [];
  /** The filters that were let go of with `keepSession` (the broker still has them). */
  readonly kept: string[] = [];
  complete = 0;

  markSubscriptionsComplete(): void {
    this.complete += 1;
  }

  subscribe(filter: string, handler: MqttMessageHandler, options?: SubscribeOptions): Unsubscribe {
    const entry = { filter, handler };
    this.handlers.push(entry);
    this.options.push(options);
    return (ending) => {
      this.handlers.splice(this.handlers.indexOf(entry), 1);
      (ending?.keepSession ? this.kept : this.unsubscribed).push(filter);
    };
  }

  get filters(): string[] {
    return this.handlers.map((entry) => entry.filter);
  }

  publish(topic: string, payload: string | Buffer, retained = false): void {
    void this.deliver(topic, payload, retained);
  }

  /** Like `publish`; resolves when the handlers are done, as the acknowledgement would be sent. */
  async deliver(topic: string, payload: string | Buffer, retained = false): Promise<void> {
    const levels = topic.split('/');
    const results: Promise<void>[] = [];
    for (const { filter, handler } of [...this.handlers]) {
      const pattern = filter.split('/');
      const hash = pattern.at(-1) === '#';
      const fixed = hash ? pattern.slice(0, -1) : pattern;
      const matches =
        (hash ? levels.length >= fixed.length : levels.length === fixed.length) &&
        fixed.every((level, index) => level === '+' || level === levels[index]);
      if (matches) results.push(Promise.resolve(handler(topic, Buffer.from(payload), retained)));
    }
    await Promise.all(results);
  }
}

describe('DeviceIngestConsumer', () => {
  let now: Date;
  let mqtt: FakeMqtt;
  let events: GatewayEvents;
  let deviceEvents: DeviceEvents;
  let announced: [string, unknown][];
  let active: ActiveGateway[];
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
    deviceEvents = new DeviceEvents();
    announced = [];
    for (const name of [DEVICE_CHANGED, HARDWARE_CHANGED]) {
      deviceEvents.on(name, (event) => announced.push([name, event]));
    }
    active = [{ id: GW, householdId: 'household', topicPrefix: prefix(GW) }];
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
    upsertFromBridge.mockResolvedValue({ upserted: 0, removed: 0, ids: [] });
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
      return Promise.resolve({
        upserted: devices.length,
        removed: 0,
        ids: devices.map((device) => `${gatewayId}:${device.ieeeAddress}`),
      });
    });
    recordJoined.mockResolvedValue('h-joined');
    setInterviewState.mockResolvedValue(undefined);
    markLeft.mockResolvedValue(undefined);
    rename.mockResolvedValue(undefined);
    setAvailability.mockResolvedValue([]);
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
      deviceEvents,
    );
  });

  afterEach(async () => {
    await consumer.onModuleDestroy();
  });

  describe('shutdown', () => {
    it('leaves its subscriptions to the persistent session', async () => {
      active = [{ id: GW, householdId: 'household', topicPrefix: prefix(GW) }];
      await start();
      await consumer.onModuleDestroy();
      expect(mqtt.kept).toEqual([`${prefix(GW)}/#`]);
      expect(mqtt.unsubscribed).toEqual([]);
    });

    it('waits at most 10 s for messages that are not done', async () => {
      vi.useFakeTimers();
      try {
        active = [{ id: GW, householdId: 'household', topicPrefix: prefix(GW) }];
        stored.set(GW, [{ id: 'hw-1', friendlyName: 'sensor-1' }]);
        await start();
        handle.mockImplementation(() => new Promise<void>(() => undefined));
        mqtt.publish(`${prefix(GW)}/sensor-1`, '{"soil_moisture":40}');
        await vi.advanceTimersByTimeAsync(0);
        const destroyed = vi.fn();
        void consumer.onModuleDestroy().then(destroyed);
        await vi.advanceTimersByTimeAsync(9999);
        expect(destroyed).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(destroyed).toHaveBeenCalledTimes(1);
        expect(logged()).toContain('not handled');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not wait when everything is handled', async () => {
      active = [{ id: GW, householdId: 'household', topicPrefix: prefix(GW) }];
      await start();
      const started = Date.now();
      await consumer.onModuleDestroy();
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  describe('subscriptions', () => {
    it('subscribes to the prefix of every active gateway on start', async () => {
      active = [
        { id: GW, householdId: 'household', topicPrefix: prefix(GW) },
        { id: OTHER, householdId: 'household', topicPrefix: prefix(OTHER) },
      ];
      await start();
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`, `${prefix(OTHER)}/#`]);
    });

    it('subscribes to a gateway that is registered later and ends it when it is revoked', async () => {
      await start();
      active.push({ id: OTHER, householdId: 'household', topicPrefix: prefix(OTHER) });
      events.emit(GATEWAY_REGISTERED, { gatewayId: OTHER, topicPrefix: prefix(OTHER) });
      await consumer.idle();
      expect(mqtt.filters).toContain(`${prefix(OTHER)}/#`);

      events.emit(GATEWAY_REVOKED, { gatewayId: OTHER });
      await consumer.idle();
      expect(mqtt.unsubscribed).toEqual([`${prefix(OTHER)}/#`]);
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
    });

    it('tells the connection when the subscriptions are made, not before the gateways are known', async () => {
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
          deviceEvents,
        );
        consumer.onModuleInit();
        await consumer.idle();
        expect(mqtt.complete).toBe(0);
        await vi.advanceTimersByTimeAsync(5000);
        await consumer.idle();
        expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
        expect(mqtt.complete).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not tell the connection when it is shut down before the gateways are followed', async () => {
      let release: (gateways: ActiveGateway[]) => void = () => undefined;
      consumer = new DeviceIngestConsumer(
        {
          listActive: () => new Promise((resolve) => (release = resolve)),
        } as unknown as GatewaysService,
        events,
        { listNames } as unknown as HardwareRepository,
        { handle },
        mqtt as unknown as MqttConnection,
        () => now,
        deviceEvents,
      );
      consumer.onModuleInit();
      await new Promise((resolve) => setImmediate(resolve));
      const destroyed = consumer.onModuleDestroy();
      release([{ id: GW, householdId: 'household', topicPrefix: prefix(GW) }]);
      await destroyed;
      await consumer.idle();
      expect(mqtt.complete).toBe(0);
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
          deviceEvents,
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
          deviceEvents,
        );
        consumer.onModuleInit();
        await consumer.idle();
        await consumer.onModuleDestroy();
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

    it('does not subscribe when the consumer was destroyed while the names were loading', async () => {
      consumer.onModuleInit();
      await consumer.idle();
      let release: (names: { id: string; friendlyName: string }[]) => void = () => undefined;
      listNames.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      events.emit(GATEWAY_REGISTERED, { gatewayId: OTHER, topicPrefix: prefix(OTHER) });
      await vi.waitFor(() => expect(listNames).toHaveBeenCalledTimes(2));
      const destroying = consumer.onModuleDestroy();
      release([]);
      await destroying;
      expect(mqtt.filters).toEqual([]);
    });

    it('takes the names from the database on start', async () => {
      stored.set(GW, [{ id: 'h-lamp', friendlyName: 'Lampe' }]);
      await start();
      await send(`${prefix(GW)}/Lampe`, { state: 'ON' });
      expect(handle).toHaveBeenCalledWith(GW, 'h-lamp', { state: 'ON' }, T0, false);
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

    it('keeps the valid entries when one is malformed, and drops only that one', async () => {
      await start();
      const [, first, second] = fixtureDevices;
      await send(`${prefix(GW)}/bridge/devices`, [
        first,
        { ...second, friendly_name: 'x'.repeat(256) },
        { ...second, ieee_address: 'not-an-address' },
        { ...second, friendly_name: 42 },
        null,
        'text',
        {
          ieee_address: '0x00000000000000b1',
          friendly_name: 'failed interview',
          type: 'EndDevice',
          interview_state: 'FAILED',
          supported: false,
          definition: null,
        },
        second,
      ]);
      expect(upsertFromBridge).toHaveBeenCalledTimes(1);
      expect(upsertFromBridge.mock.calls[0]?.[1].map((device) => device.friendlyName)).toEqual([
        first?.friendly_name,
        'failed interview',
        second?.friendly_name,
      ]);
      expect(consumer.discarded.invalid).toBe(5);
    });

    it('still discards a list that is no array', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, { devices: [] });
      await send(`${prefix(GW)}/bridge/devices`, 'garbage');
      expect(upsertFromBridge).not.toHaveBeenCalled();
      expect(consumer.discarded.invalid).toBe(2);
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
        false,
      );
    });

    it('follows a rename that a new retained device list brings', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      const renamed = fixtureDevices.map((device) =>
        device.friendly_name === 'Lampe' ? { ...device, friendly_name: 'Stehlampe' } : device,
      );
      await send(`${prefix(GW)}/bridge/devices`, renamed, true);
      await send(`${prefix(GW)}/Lampe`, { state: 'OFF' });
      await send(`${prefix(GW)}/Stehlampe`, { state: 'ON' });
      expect(handle.mock.calls.map((call) => [call[1], call[2]])).toEqual([
        [`${GW}:0x00000000000000a7`, { state: 'ON' }],
      ]);
      expect(consumer.discarded.unknownName).toBe(1);
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
      active.push({ id: OTHER, householdId: 'household', topicPrefix: prefix(OTHER) });
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
        false,
      );
    });

    it('passes the retain flag on, so that a replay can be told from a fresh report', async () => {
      await send(`${prefix(GW)}/Pflanze 2`, { battery: 90 }, true);
      await send(`${prefix(GW)}/Pflanze 2`, { battery: 89 }, false);
      expect(handle.mock.calls.map((call) => call[4])).toEqual([true, false]);
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
      expect(consumer.discarded).toEqual({ unknownName: 0, invalid: 0, overflow: 0 });
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

  describe('backpressure', () => {
    beforeEach(async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
    });

    /** Makes the handler wait until `release()`. */
    const hold = (): { release: () => void } => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      handle.mockImplementation(() => gate);
      return { release };
    };

    it('subscribes at QoS 1 and holds the acknowledgement back until the message is processed', () => {
      expect(mqtt.options).toEqual([{ qos: 1, ackAfterHandler: true }]);
    });

    it('settles what it hands to the subscription only when the message is processed', async () => {
      const { release } = hold();
      const settled = vi.fn();
      void mqtt.deliver(`${prefix(GW)}/Pflanze 1`, '{"soil_moisture":41}').then(settled);
      await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).not.toHaveBeenCalled();

      release();
      await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    });

    it('settles also when the message could not be processed', async () => {
      handle.mockRejectedValueOnce(new Error('payload-value'));
      await mqtt.deliver(`${prefix(GW)}/Pflanze 1`, '{"soil_moisture":41}');
      await mqtt.deliver(`${prefix(GW)}/Pflanze 1`, 'garbage');
      await mqtt.deliver(`${prefix(GW)}/Lampe/set`, '{}');
      await mqtt.deliver(`${prefix(GW)}/ghost`, '{}');
      await mqtt.deliver(`${prefix(GW)}/bridge/request/x`, '{}');
      expect(logged()).not.toContain('payload-value');
    });

    it('does not drop messages however many are waiting, as long as they are not too big', async () => {
      const { release } = hold();
      for (let n = 0; n < 5000; n += 1) mqtt.publish(`${prefix(GW)}/Pflanze 1`, '{"battery":90}');
      release();
      await consumer.idle();
      expect(handle).toHaveBeenCalledTimes(5000);
      expect(consumer.discarded.overflow).toBe(0);
    });

    it('bounds the waiting messages by their size and reports the drops once a minute', async () => {
      const { release } = hold();
      const big = JSON.stringify({ text: 'x'.repeat(60_000) });
      // 64 MiB are about 1090 of these.
      for (let n = 0; n < 1200; n += 1) mqtt.publish(`${prefix(GW)}/Pflanze 1`, big);
      expect(consumer.discarded.overflow).toBeGreaterThan(50);
      expect(consumer.discarded.overflow).toBeLessThan(150);
      const drops = (): string[] =>
        warn.mock.calls.map(String).filter((line) => line.includes('Dropped'));
      expect(drops()).toHaveLength(1);
      expect(drops()[0]).not.toContain('xxxx');

      now = new Date(T0.getTime() + 61_000);
      mqtt.publish(`${prefix(GW)}/Pflanze 1`, big);
      expect(drops()).toHaveLength(2);
      release();
      await consumer.idle();
      // What was in the queue is handled; the space is free again.
      const before = handle.mock.calls.length;
      await send(`${prefix(GW)}/Pflanze 1`, '{"battery":1}');
      expect(handle).toHaveBeenCalledTimes(before + 1);
    });
  });

  describe('shutdown', () => {
    it('processes what it has received before onModuleDestroy returns', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      handle.mockImplementation(() => gate);
      for (let n = 0; n < 3; n += 1) mqtt.publish(`${prefix(GW)}/Pflanze 1`, '{"battery":90}');
      await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));

      const destroyed = vi.fn();
      const destroying = consumer.onModuleDestroy().then(destroyed);
      expect(mqtt.filters).toEqual([]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(destroyed).not.toHaveBeenCalled();

      release();
      await destroying;
      expect(handle).toHaveBeenCalledTimes(3);
    });

    it('does not take messages any more once it is destroyed', async () => {
      await start();
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      await consumer.onModuleDestroy();
      await send(`${prefix(GW)}/Pflanze 1`, '{"battery":90}');
      expect(handle).not.toHaveBeenCalled();
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
      expect(handle).toHaveBeenCalledWith(
        GW,
        `${GW}:0x00000000000000a7`,
        { state: 'ON' },
        T0,
        false,
      );
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
      expect(handle).toHaveBeenCalledWith(GW, 'h-joined', { battery: 80 }, T0, false);
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

    it.each([
      [
        'joined',
        {
          type: 'device_joined',
          data: { friendly_name: 'new', ieee_address: '0x00000000000000c1' },
        },
        recordJoined,
        'h-new',
      ],
      [
        'renamed',
        { type: 'device_renamed', data: { from: 'Lampe', to: 'Stehlampe' } },
        rename,
        `${GW}:0x00000000000000a7`,
      ],
    ])(
      'does not bring back the names of a gateway that was revoked while a %s event was stored',
      async (_label, event, repository, result) => {
        let release: (id: string) => void = () => undefined;
        (repository as ReturnType<typeof vi.fn>).mockReturnValueOnce(
          new Promise<string>((resolve) => (release = resolve)),
        );
        mqtt.publish(`${prefix(GW)}/bridge/event`, JSON.stringify(event));
        await vi.waitFor(() => expect(repository).toHaveBeenCalled());
        events.emit(GATEWAY_REVOKED, { gatewayId: GW });
        release(result);
        await consumer.idle();
        const names = (consumer as unknown as { names: NameMap }).names;
        expect(['new', 'Stehlampe', 'Lampe'].map((name) => names.lookup(GW, name))).toEqual([
          undefined,
          undefined,
          undefined,
        ]);
      },
    );

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

    it('forgets the availability heard for a gateway that is revoked', async () => {
      await send(`${prefix(GW)}/ghost/availability`, 'online');
      const pending = (consumer as unknown as { pendingAvailability: Map<string, string> })
        .pendingAvailability;
      expect(pending.size).toBe(1);
      events.emit(GATEWAY_REVOKED, { gatewayId: GW });
      expect(pending.size).toBe(0);
    });

    it('applies an availability that arrived before the device list', async () => {
      active.push({ id: OTHER, householdId: 'household', topicPrefix: prefix(OTHER) });
      events.emit(GATEWAY_REGISTERED, { gatewayId: OTHER, topicPrefix: prefix(OTHER) });
      await consumer.idle();
      await send(`${prefix(OTHER)}/Lampe/availability`, '{"state":"online"}', true);
      expect(setAvailability).not.toHaveBeenCalled();
      await send(`${prefix(OTHER)}/bridge/devices`, JSON.parse(fixture), true);
      expect(setAvailability).toHaveBeenCalledWith(`${OTHER}:0x00000000000000a7`, 'online');
    });
  });

  describe('announcements', () => {
    const hw = (hardwareId: string): [string, unknown] => [HARDWARE_CHANGED, { hardwareId }];
    const event = (type: string, data: unknown) =>
      send(`${prefix(GW)}/bridge/event`, { type, data });

    beforeEach(async () => {
      await start();
    });

    it('announces the hardware of a bridge list that was stored', async () => {
      upsertFromBridge.mockResolvedValue({ upserted: 2, removed: 1, ids: ['h1', 'h2', 'h3'] });
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      expect(announced).toEqual([hw('h1'), hw('h2'), hw('h3')]);
    });

    it('announces nothing for a list that is thrown away', async () => {
      await send(`${prefix(GW)}/bridge/devices`, 'garbage');
      expect(announced).toEqual([]);
    });

    it('announces the hardware that joined, was interviewed, left or was renamed', async () => {
      await event('device_joined', { friendly_name: 'new', ieee_address: '0x00000000000000c1' });
      expect(announced).toEqual([hw('h-joined')]);

      announced.length = 0;
      setInterviewState.mockResolvedValue('h-int');
      await event('device_interview', {
        friendly_name: 'new',
        ieee_address: '0x00000000000000c1',
        status: 'successful',
      });
      expect(announced).toEqual([hw('h-int')]);

      announced.length = 0;
      markLeft.mockResolvedValue({ id: 'h-left', friendlyName: 'new' });
      await event('device_leave', { friendly_name: 'new', ieee_address: '0x00000000000000c1' });
      expect(announced).toEqual([hw('h-left')]);

      announced.length = 0;
      rename.mockResolvedValue('h-renamed');
      await event('device_renamed', { from: 'a', to: 'b' });
      expect(announced).toEqual([hw('h-renamed')]);
    });

    it('announces nothing when an event matched no hardware', async () => {
      await event('device_interview', {
        friendly_name: 'x',
        ieee_address: '0x00000000000000c1',
        status: 'failed',
      });
      await event('device_leave', { friendly_name: 'x', ieee_address: '0x00000000000000c1' });
      await event('device_renamed', { from: 'a', to: 'b' });
      expect(announced).toEqual([]);
    });

    it('announces the hardware and the devices on it for an availability', async () => {
      await send(`${prefix(GW)}/bridge/devices`, JSON.parse(fixture));
      announced.length = 0;
      setAvailability.mockResolvedValue([{ deviceId: 'd1', householdId: 'hh' }]);
      await send(`${prefix(GW)}/Pflanze 3/availability`, 'online');
      expect(announced).toEqual([
        hw(`${GW}:0x00000000000000a3`),
        [DEVICE_CHANGED, { householdId: 'hh', deviceId: 'd1' }],
      ]);
    });

    it('announces the hardware of an availability that was kept until the list came', async () => {
      active.push({ id: OTHER, householdId: 'household', topicPrefix: prefix(OTHER) });
      events.emit(GATEWAY_REGISTERED, { gatewayId: OTHER, topicPrefix: prefix(OTHER) });
      await consumer.idle();
      await send(`${prefix(OTHER)}/Lampe/availability`, 'online', true);
      announced.length = 0;
      setAvailability.mockResolvedValue([{ deviceId: 'd2', householdId: 'hh' }]);
      await send(`${prefix(OTHER)}/bridge/devices`, JSON.parse(fixture), true);
      expect(announced).toContainEqual(hw(`${OTHER}:0x00000000000000a7`));
      expect(announced).toContainEqual([DEVICE_CHANGED, { householdId: 'hh', deviceId: 'd2' }]);
    });
  });
});
