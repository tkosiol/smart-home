import { Logger } from '@nestjs/common';
import type { GatewayKind } from '@smart/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MqttConnection,
  MqttMessageHandler,
  SubscribeOptions,
  Unsubscribe,
} from '../../platform/mqtt/index.js';
import {
  AdapterRegistry,
  type AdapterEvent,
  type AdapterMessage,
  type DecodedReport,
  type GatewayAdapter,
  type ReportedHardware,
  type StoredCapability,
} from '../adapters/index.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GatewayEvents,
  type ActiveGateway,
  type GatewayRegistered,
  type GatewaysService,
} from '../gateways/index.js';
import type { AddressBook } from './address-book.js';
import { DEVICE_CHANGED, DeviceEvents, HARDWARE_CHANGED } from './device-events.js';
import type { DeviceReportProcessor } from './device-report.processor.js';
import { GatewayIngest, SHUTDOWN_DRAIN_MS } from './gateway-ingest.js';
import type { HardwareRepository } from './hardware.repository.js';

const T0 = new Date('2026-10-14T12:00:00Z');
const GW = 'gw-a1b2c3d4';
const OTHER = 'gw-e5f6a7b8';
const KIND = 'z2m';
const prefix = (id: string): string => `gw/${id}/${KIND}`;
const gatewayOf = (id: string): ActiveGateway => ({
  id,
  householdId: 'household',
  kind: KIND,
  topicPrefix: prefix(id),
});
const registered = (id: string): GatewayRegistered => ({
  gatewayId: id,
  kind: KIND,
  topicPrefix: prefix(id),
});

const parse = (payload: Buffer): unknown => {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return undefined;
  }
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const CAPABILITIES: StoredCapability[] = [
  {
    key: 'soil_moisture',
    kind: 'numeric',
    unit: '%',
    min: 0,
    max: 100,
    step: null,
    enumValues: null,
    readable: true,
    writable: false,
    isSetting: false,
    native: { field: 'moist' },
  },
];

/** Hardware of the made-up kind: its address is the external ID turned to lower case. */
const hardwareOf = (externalId: string, address: string | null = externalId.toLowerCase()) =>
  ({
    externalId,
    address,
    name: externalId,
    vendor: 'Acme',
    model: 'M1',
    description: null,
    setupState: 'ready',
    native: {},
    capabilities: CAPABILITIES,
  }) satisfies ReportedHardware;

/**
 * A gateway kind made up for the test, with nothing of any real system: `list` carries the full
 * hardware list, `events` a list of neutral events as they are, `dev/<address>` a report and
 * `avail/<address>` the availability. It registers as the one kind the contracts know.
 */
class FakeAdapter implements GatewayAdapter {
  readonly kind = KIND;
  readonly serviceStatusTopic = 'status';
  readonly decoded: { native: unknown; capabilities: readonly StoredCapability[] }[] = [];

  parseServiceStatus(): undefined {
    return undefined;
  }

  classify(topic: string): { maxBytes: number } | undefined {
    if (topic === 'list') return { maxBytes: 1024 * 1024 };
    if (topic === 'events') return { maxBytes: 64 * 1024 };
    if (/^dev\/.+/.test(topic)) return { maxBytes: 64 * 1024 };
    if (/^avail\/.+/.test(topic)) return { maxBytes: 1024 };
    return undefined;
  }

  translate({ topic, payload }: AdapterMessage): AdapterEvent[] {
    const json = parse(payload);
    if (topic === 'list') {
      return Array.isArray(json)
        ? [{ type: 'hardware.listed', hardware: json as ReportedHardware[] }]
        : [];
    }
    if (topic === 'events') return Array.isArray(json) ? (json as AdapterEvent[]) : [];
    if (topic.startsWith('dev/')) {
      const address = topic.slice('dev/'.length);
      return isObject(json)
        ? [{ type: 'hardware.report', ref: { address }, native: json }, { type: 'activity' }]
        : [{ type: 'activity' }];
    }
    if (topic.startsWith('avail/')) {
      const address = topic.slice('avail/'.length);
      const text = payload.toString('utf8');
      return text === 'online' || text === 'offline'
        ? [
            { type: 'hardware.availability', ref: { address }, availability: text },
            { type: 'activity' },
          ]
        : [{ type: 'activity' }];
    }
    return [];
  }

  /** `{ v: values, t: time }` of the made-up format. */
  decodeReport(native: unknown, capabilities: readonly StoredCapability[]): DecodedReport {
    this.decoded.push({ native, capabilities });
    const report = isObject(native) ? native : {};
    return {
      values: isObject(report.v) ? report.v : {},
      measuredAt: typeof report.t === 'string' ? new Date(report.t) : undefined,
    };
  }
}

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

describe('GatewayIngest', () => {
  let now: Date;
  let mqtt: FakeMqtt;
  let adapter: FakeAdapter;
  let registry: AdapterRegistry;
  let events: GatewayEvents;
  let deviceEvents: DeviceEvents;
  let announced: [string, unknown][];
  let active: ActiveGateway[];
  let stored: Map<string, { id: string; address: string }[]>;
  let ingest: GatewayIngest;
  const listActive = vi.fn<GatewaysService['listActive']>();
  const touch = vi.fn<GatewaysService['touch']>();
  const replaceListed = vi.fn<HardwareRepository['replaceListed']>();
  const listAddresses = vi.fn<HardwareRepository['listAddresses']>();
  const recordJoined = vi.fn<HardwareRepository['recordJoined']>();
  const setSetupState = vi.fn<HardwareRepository['setSetupState']>();
  const markLeft = vi.fn<HardwareRepository['markLeft']>();
  const readdress = vi.fn<HardwareRepository['readdress']>();
  const setAvailability = vi.fn<HardwareRepository['setAvailability']>();
  const capabilitiesOf = vi.fn<HardwareRepository['capabilitiesOf']>();
  const findByExternalId = vi.fn<HardwareRepository['findByExternalId']>();
  const handle = vi.fn<DeviceReportProcessor['handle']>();
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const logged = (): string => [...log.mock.calls, ...warn.mock.calls].map(String).join('\n');

  const create = (): GatewayIngest =>
    new GatewayIngest(
      { listActive, touch } as unknown as GatewaysService,
      events,
      {
        replaceListed,
        listAddresses,
        recordJoined,
        setSetupState,
        markLeft,
        readdress,
        setAvailability,
        capabilitiesOf,
        findByExternalId,
      } as unknown as HardwareRepository,
      { handle } as unknown as DeviceReportProcessor,
      registry,
      mqtt as unknown as MqttConnection,
      () => now,
      deviceEvents,
    );

  const send = async (topic: string, payload: unknown, retained = false): Promise<void> => {
    mqtt.publish(
      topic,
      typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload),
      retained,
    );
    await ingest.idle();
  };
  const list = (id: string, hardware: ReportedHardware[], retained = false) =>
    send(`${prefix(id)}/list`, hardware, retained);
  const emit = (id: string, ...adapterEvents: AdapterEvent[]) =>
    send(`${prefix(id)}/events`, adapterEvents);
  const report = (id: string, address: string, values: Record<string, unknown>, retained = false) =>
    send(`${prefix(id)}/dev/${address}`, { v: values }, retained);
  /** What the processor was handed: hardware and values. */
  const handled = () => handle.mock.calls.map(([input]) => [input.hardwareId, input.values]);

  const start = async (): Promise<void> => {
    ingest.onModuleInit();
    await ingest.idle();
  };

  beforeEach(() => {
    now = T0;
    mqtt = new FakeMqtt();
    adapter = new FakeAdapter();
    registry = new AdapterRegistry([adapter]);
    events = new GatewayEvents();
    deviceEvents = new DeviceEvents();
    announced = [];
    for (const name of [DEVICE_CHANGED, HARDWARE_CHANGED]) {
      deviceEvents.on(name, (event) => announced.push([name, event]));
    }
    active = [gatewayOf(GW)];
    stored = new Map();
    for (const mock of [
      listActive,
      touch,
      replaceListed,
      listAddresses,
      recordJoined,
      setSetupState,
      markLeft,
      readdress,
      setAvailability,
      capabilitiesOf,
      findByExternalId,
      handle,
    ]) {
      mock.mockReset();
    }
    listActive.mockImplementation(() => Promise.resolve(active));
    touch.mockResolvedValue(true);
    // After a list the database holds the listed hardware under ids `<gateway>:<external ID>`.
    listAddresses.mockImplementation((gatewayId) => Promise.resolve(stored.get(gatewayId) ?? []));
    replaceListed.mockImplementation((gatewayId, hardware) => {
      stored.set(
        gatewayId,
        hardware.flatMap((item) =>
          item.address === null
            ? []
            : [{ id: `${gatewayId}:${item.externalId}`, address: item.address }],
        ),
      );
      return Promise.resolve({ ids: hardware.map((item) => `${gatewayId}:${item.externalId}`) });
    });
    recordJoined.mockResolvedValue('h-joined');
    setSetupState.mockResolvedValue(undefined);
    markLeft.mockResolvedValue(undefined);
    readdress.mockResolvedValue(undefined);
    setAvailability.mockResolvedValue([]);
    capabilitiesOf.mockResolvedValue(CAPABILITIES);
    findByExternalId.mockResolvedValue(undefined);
    handle.mockResolvedValue();
    log.mockClear();
    warn.mockClear();
    ingest = create();
  });

  afterEach(async () => {
    await ingest.onModuleDestroy();
  });

  describe('subscriptions', () => {
    it('subscribes to the prefix of every active gateway on start, at QoS 1, acknowledged once handled', async () => {
      active = [gatewayOf(GW), gatewayOf(OTHER)];
      await start();
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`, `${prefix(OTHER)}/#`]);
      expect(mqtt.options).toEqual([
        { qos: 1, ackAfterHandler: true },
        { qos: 1, ackAfterHandler: true },
      ]);
    });

    it('subscribes to a gateway that is registered later and ends it when it is revoked', async () => {
      await start();
      events.emit(GATEWAY_REGISTERED, registered(OTHER));
      await ingest.idle();
      expect(mqtt.filters).toContain(`${prefix(OTHER)}/#`);

      events.emit(GATEWAY_REVOKED, { gatewayId: OTHER });
      // At once, not after what is queued.
      expect(mqtt.unsubscribed).toEqual([`${prefix(OTHER)}/#`]);
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
    });

    it('leaves a gateway of a kind without adapter alone and says so once', async () => {
      const unknown = { ...gatewayOf(OTHER), kind: 'zz' as GatewayKind };
      active = [unknown, gatewayOf(GW)];
      await start();
      events.emit(GATEWAY_REGISTERED, { ...registered(OTHER), kind: 'zz' as GatewayKind });
      await ingest.idle();
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
      expect(mqtt.complete).toBe(1);
      const notes = [...log.mock.calls, ...warn.mock.calls].filter((call) =>
        String(call).includes(OTHER),
      );
      expect(notes).toHaveLength(1);
      expect(String(notes[0])).toContain('zz');
    });

    it('tells the connection when the subscriptions are made, not before the gateways are known', async () => {
      vi.useFakeTimers();
      try {
        listActive.mockReset();
        listActive
          .mockRejectedValueOnce(new Error('relation "gateways" does not exist'))
          .mockResolvedValue(active);
        ingest.onModuleInit();
        await ingest.idle();
        expect(mqtt.complete).toBe(0);
        expect(mqtt.filters).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5000);
        await ingest.idle();
        expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
        expect(mqtt.complete).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not tell the connection when it is shut down before the gateways are followed', async () => {
      let release: (gateways: ActiveGateway[]) => void = () => undefined;
      listActive.mockReset();
      listActive.mockReturnValue(new Promise((resolve) => (release = resolve)));
      ingest.onModuleInit();
      await new Promise((resolve) => setImmediate(resolve));
      const destroyed = ingest.onModuleDestroy();
      release([gatewayOf(GW)]);
      await destroyed;
      await ingest.idle();
      expect(mqtt.complete).toBe(0);
    });

    it('does not try again after it was destroyed', async () => {
      vi.useFakeTimers();
      try {
        listActive.mockReset();
        listActive.mockRejectedValue(new Error('x'));
        ingest.onModuleInit();
        await ingest.idle();
        await ingest.onModuleDestroy();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(listActive).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('subscribes once when a gateway is announced twice', async () => {
      await start();
      for (let n = 0; n < 2; n += 1) events.emit(GATEWAY_REGISTERED, registered(GW));
      await ingest.idle();
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
    });

    it('stops handling the messages that a revoked gateway already had queued', async () => {
      await start();
      await list(GW, [hardwareOf('A1')]);
      mqtt.publish(`${prefix(GW)}/dev/a1`, JSON.stringify({ v: { soil_moisture: 1 } }));
      events.emit(GATEWAY_REVOKED, { gatewayId: GW });
      await ingest.idle();
      expect(handle).not.toHaveBeenCalled();
      expect(touch).not.toHaveBeenCalled();
    });

    it('does not subscribe to a gateway that is revoked while its addresses are loading', async () => {
      await start();
      let release: (rows: { id: string; address: string }[]) => void = () => undefined;
      listAddresses.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      events.emit(GATEWAY_REGISTERED, registered(OTHER));
      events.emit(GATEWAY_REVOKED, { gatewayId: OTHER });
      release([]);
      await ingest.idle();
      expect(mqtt.filters).toEqual([`${prefix(GW)}/#`]);
    });

    it('does not subscribe when it was destroyed while the addresses were loading', async () => {
      await start();
      let release: (rows: { id: string; address: string }[]) => void = () => undefined;
      listAddresses.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      events.emit(GATEWAY_REGISTERED, registered(OTHER));
      await vi.waitFor(() => expect(listAddresses).toHaveBeenCalledTimes(2));
      const destroying = ingest.onModuleDestroy();
      release([]);
      await destroying;
      expect(mqtt.filters).toEqual([]);
    });

    it('takes the addresses from the database on start', async () => {
      stored.set(GW, [{ id: 'h-stored', address: 'kept' }]);
      await start();
      await report(GW, 'kept', { soil_moisture: 40 });
      expect(handled()).toEqual([['h-stored', { soil_moisture: 40 }]]);
    });
  });

  describe('what the adapter decides', () => {
    beforeEach(start);

    it('neither handles nor counts a topic the adapter has no use for', async () => {
      await send(`${prefix(GW)}/elsewhere`, '{}');
      await send(`${prefix(GW)}/dev`, '{}');
      await send(`${prefix(GW)}`, '{}');
      expect(replaceListed).not.toHaveBeenCalled();
      expect(touch).not.toHaveBeenCalled();
      expect(ingest.discarded).toEqual({ unknownName: 0, invalid: 0, overflow: 0 });
    });

    it('discards and counts a payload bigger than the adapter allows for the topic', async () => {
      await send(`${prefix(GW)}/avail/a1`, Buffer.alloc(1025, 0x20));
      await send(`${prefix(GW)}/list`, Buffer.alloc(1024 * 1024 + 1, 0x20));
      expect(touch).not.toHaveBeenCalled();
      expect(replaceListed).not.toHaveBeenCalled();
      expect(ingest.discarded.invalid).toBe(2);
    });

    it('hands the adapter the topic below the prefix and the payload', async () => {
      const translate = vi.spyOn(adapter, 'translate');
      await send(`${prefix(GW)}/dev/a/b`, '{"v":{}}');
      expect(translate).toHaveBeenCalledWith({
        gatewayId: GW,
        topic: 'dev/a/b',
        payload: Buffer.from('{"v":{}}'),
      });
    });

    it('goes on after the adapter or the processor failed, without logging the reason', async () => {
      await list(GW, [hardwareOf('A1')]);
      vi.spyOn(adapter, 'translate').mockImplementationOnce(() => {
        throw new Error('payload-value');
      });
      await report(GW, 'a1', { soil_moisture: 1 });
      handle.mockRejectedValueOnce(new Error('payload-value'));
      await report(GW, 'a1', { soil_moisture: 2 });
      await report(GW, 'a1', { soil_moisture: 3 });
      expect(handled()).toEqual([
        [`${GW}:A1`, { soil_moisture: 2 }],
        [`${GW}:A1`, { soil_moisture: 3 }],
      ]);
      expect(logged()).not.toContain('payload-value');
    });
  });

  describe('hardware.listed', () => {
    beforeEach(start);

    it('stores the list and announces each hardware it touched', async () => {
      await list(GW, [hardwareOf('A1'), hardwareOf('A2')], true);
      expect(replaceListed).toHaveBeenCalledWith(GW, [hardwareOf('A1'), hardwareOf('A2')], T0);
      expect(announced).toEqual([
        [HARDWARE_CHANGED, { hardwareId: `${GW}:A1` }],
        [HARDWARE_CHANGED, { hardwareId: `${GW}:A2` }],
      ]);
    });

    it('renews the address book: a new list decides which addresses lead to hardware', async () => {
      await list(GW, [hardwareOf('A1'), hardwareOf('A2')]);
      await report(GW, 'a2', { soil_moisture: 2 });
      await list(GW, [hardwareOf('A1'), hardwareOf('A2', 'moved')]);
      await report(GW, 'a2', { soil_moisture: 3 });
      await report(GW, 'moved', { soil_moisture: 4 });
      expect(handled()).toEqual([
        [`${GW}:A2`, { soil_moisture: 2 }],
        [`${GW}:A2`, { soil_moisture: 4 }],
      ]);
      expect(ingest.discarded.unknownName).toBe(1);
    });

    it('keeps the hardware of two gateways with the same address apart', async () => {
      events.emit(GATEWAY_REGISTERED, registered(OTHER));
      await ingest.idle();
      await list(GW, [hardwareOf('A1')]);
      await list(OTHER, [hardwareOf('A1')]);
      await report(GW, 'a1', { soil_moisture: 1 });
      await report(OTHER, 'a1', { soil_moisture: 2 });
      expect(handle.mock.calls.map(([input]) => [input.gatewayId, input.hardwareId])).toEqual([
        [GW, `${GW}:A1`],
        [OTHER, `${OTHER}:A1`],
      ]);
    });

    it('keeps a list before the report that depends on it, however slow storing it is', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const store = replaceListed.getMockImplementation();
      replaceListed.mockImplementationOnce(async (...args) => {
        await gate;
        return store ? store(...args) : { ids: [] };
      });
      mqtt.publish(`${prefix(GW)}/list`, JSON.stringify([hardwareOf('A1')]));
      mqtt.publish(`${prefix(GW)}/dev/a1`, JSON.stringify({ v: { soil_moisture: 1 } }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(handle).not.toHaveBeenCalled();
      release();
      await ingest.idle();
      expect(handled()).toEqual([[`${GW}:A1`, { soil_moisture: 1 }]]);
      expect(ingest.discarded.unknownName).toBe(0);
    });

    it('applies an availability that arrived before the list, and announces it', async () => {
      await send(`${prefix(GW)}/avail/a1`, 'online', true);
      expect(setAvailability).not.toHaveBeenCalled();
      setAvailability.mockResolvedValue([{ deviceId: 'd1', householdId: 'hh' }]);
      await list(GW, [hardwareOf('A1')], true);
      expect(setAvailability).toHaveBeenCalledWith(`${GW}:A1`, 'online');
      expect(announced).toContainEqual([DEVICE_CHANGED, { householdId: 'hh', deviceId: 'd1' }]);
      // Applied once: a later list does not apply it again.
      await list(GW, [hardwareOf('A1')], true);
      expect(setAvailability).toHaveBeenCalledTimes(1);
    });

    it('forgets the availability heard for a gateway that is revoked', async () => {
      await send(`${prefix(GW)}/avail/ghost`, 'online');
      const pending = (ingest as unknown as { pendingAvailability: Map<string, string> })
        .pendingAvailability;
      expect(pending.size).toBe(1);
      events.emit(GATEWAY_REVOKED, { gatewayId: GW });
      expect(pending.size).toBe(0);
    });
  });

  describe('hardware.joined, setup, left and readdressed', () => {
    beforeEach(async () => {
      await start();
      await list(GW, [hardwareOf('A1')]);
      announced.length = 0;
    });

    it('adds hardware that joined, reachable at its address at once', async () => {
      await emit(GW, { type: 'hardware.joined', externalId: 'C1', address: 'c1', name: 'New' });
      expect(recordJoined).toHaveBeenCalledWith(GW, 'C1', 'c1', 'New', T0);
      expect(announced).toEqual([[HARDWARE_CHANGED, { hardwareId: 'h-joined' }]]);
      await report(GW, 'c1', { soil_moisture: 80 });
      expect(handled()).toEqual([['h-joined', { soil_moisture: 80 }]]);
    });

    it('adds hardware without an address', async () => {
      await emit(GW, { type: 'hardware.joined', externalId: 'C2', address: null, name: 'Quiet' });
      expect(recordJoined).toHaveBeenCalledWith(GW, 'C2', null, 'Quiet', T0);
    });

    it('stores the setup state and announces the hardware it found', async () => {
      setSetupState.mockResolvedValueOnce(`${GW}:A1`);
      await emit(GW, { type: 'hardware.setup', externalId: 'A1', setupState: 'ready' });
      await emit(GW, { type: 'hardware.setup', externalId: 'X9', setupState: 'failed' });
      expect(setSetupState.mock.calls).toEqual([
        [GW, 'A1', 'ready'],
        [GW, 'X9', 'failed'],
      ]);
      expect(announced).toEqual([[HARDWARE_CHANGED, { hardwareId: `${GW}:A1` }]]);
    });

    it('marks hardware that left as removed and forgets its address', async () => {
      markLeft.mockResolvedValueOnce({ id: `${GW}:A1`, address: 'a1' });
      await emit(GW, { type: 'hardware.left', externalId: 'A1' });
      expect(markLeft).toHaveBeenCalledWith(GW, 'A1', T0);
      expect(announced).toEqual([[HARDWARE_CHANGED, { hardwareId: `${GW}:A1` }]]);
      await report(GW, 'a1', { soil_moisture: 1 });
      expect(handle).not.toHaveBeenCalled();
    });

    it('follows a new address: reports there reach the same hardware, the old one leads nowhere', async () => {
      readdress.mockResolvedValueOnce(`${GW}:A1`);
      await emit(GW, { type: 'hardware.readdressed', from: 'a1', to: 'b1', name: 'Renamed' });
      expect(readdress).toHaveBeenCalledWith(GW, 'a1', 'b1', 'Renamed');
      expect(announced).toEqual([[HARDWARE_CHANGED, { hardwareId: `${GW}:A1` }]]);
      await report(GW, 'b1', { soil_moisture: 1 });
      await report(GW, 'a1', { soil_moisture: 2 });
      expect(handled()).toEqual([[`${GW}:A1`, { soil_moisture: 1 }]]);
      expect(ingest.discarded.unknownName).toBe(1);
    });

    it('announces nothing when an event matched no hardware', async () => {
      await emit(GW, { type: 'hardware.left', externalId: 'X9' });
      await emit(GW, { type: 'hardware.readdressed', from: 'x', to: 'y', name: 'y' });
      expect(announced).toEqual([]);
    });

    it.each([
      [
        'joined',
        { type: 'hardware.joined', externalId: 'C1', address: 'c1', name: 'c1' },
        recordJoined,
        'h-new',
      ],
      [
        'readdressed',
        { type: 'hardware.readdressed', from: 'a1', to: 'b1', name: 'b1' },
        readdress,
        `${GW}:A1`,
      ],
    ] as const)(
      'does not bring back the addresses of a gateway that was revoked while it was %s',
      async (_label, event, repository, result) => {
        let release: (id: string) => void = () => undefined;
        (repository as ReturnType<typeof vi.fn>).mockReturnValueOnce(
          new Promise<string>((resolve) => (release = resolve)),
        );
        mqtt.publish(`${prefix(GW)}/events`, JSON.stringify([event]));
        await vi.waitFor(() => expect(repository).toHaveBeenCalled());
        events.emit(GATEWAY_REVOKED, { gatewayId: GW });
        release(result);
        await ingest.idle();
        const book = (ingest as unknown as { addresses: AddressBook }).addresses;
        expect(['c1', 'b1', 'a1'].map((address) => book.lookup(GW, address))).toEqual([
          undefined,
          undefined,
          undefined,
        ]);
      },
    );
  });

  describe('hardware.report', () => {
    beforeEach(async () => {
      await start();
      await list(GW, [hardwareOf('A1')]);
    });

    it('decodes with the stored capabilities and hands the values on', async () => {
      const stored: StoredCapability[] = [{ ...CAPABILITIES[0], native: { field: 'other' } }];
      capabilitiesOf.mockResolvedValueOnce(stored);
      now = new Date('2026-10-14T12:30:00Z');
      await send(`${prefix(GW)}/dev/a1`, {
        v: { soil_moisture: 12 },
        t: '2026-10-14T12:29:00.000Z',
      });
      expect(capabilitiesOf).toHaveBeenCalledWith(`${GW}:A1`);
      expect(adapter.decoded).toEqual([
        {
          native: { v: { soil_moisture: 12 }, t: '2026-10-14T12:29:00.000Z' },
          capabilities: stored,
        },
      ]);
      expect(handle).toHaveBeenCalledWith({
        gatewayId: GW,
        hardwareId: `${GW}:A1`,
        values: { soil_moisture: 12 },
        measuredAt: new Date('2026-10-14T12:29:00.000Z'),
        receivedAt: now,
        retained: false,
        capabilities: stored,
      });
    });

    it('passes the retain flag on, so that a replay can be told from a fresh report', async () => {
      await report(GW, 'a1', { soil_moisture: 1 }, true);
      await report(GW, 'a1', { soil_moisture: 2 }, false);
      expect(handle.mock.calls.map(([input]) => input.retained)).toEqual([true, false]);
    });

    it('counts a report for an unknown address and logs it once an hour per address', async () => {
      await send(`${prefix(GW)}/dev/ghost`, { v: { secret: 'payload-value' } });
      await send(`${prefix(GW)}/dev/ghost`, { v: { secret: 'payload-value' } });
      await send(`${prefix(GW)}/dev/other ghost`, { v: { secret: 'payload-value' } });
      expect(handle).not.toHaveBeenCalled();
      expect(capabilitiesOf).not.toHaveBeenCalled();
      expect(ingest.discarded.unknownName).toBe(3);
      expect(log.mock.calls.length + warn.mock.calls.length).toBe(2);
      expect(logged()).toContain('ghost');
      expect(logged()).not.toContain('payload-value');
      now = new Date(T0.getTime() + 3_600_001);
      await send(`${prefix(GW)}/dev/ghost`, { v: {} });
      expect(log.mock.calls.length + warn.mock.calls.length).toBe(3);
    });

    it('finds hardware by its external ID in the database', async () => {
      findByExternalId.mockImplementation((_gateway, externalId) =>
        Promise.resolve(externalId === 'A1' ? `${GW}:A1` : undefined),
      );
      await emit(
        GW,
        { type: 'hardware.report', ref: { externalId: 'A1' }, native: { v: { soil_moisture: 5 } } },
        { type: 'hardware.report', ref: { externalId: 'ZZ' }, native: { v: { soil_moisture: 6 } } },
      );
      expect(findByExternalId.mock.calls).toEqual([
        [GW, 'A1'],
        [GW, 'ZZ'],
      ]);
      expect(handled()).toEqual([[`${GW}:A1`, { soil_moisture: 5 }]]);
      expect(ingest.discarded.unknownName).toBe(1);
    });
  });

  describe('hardware.availability', () => {
    beforeEach(async () => {
      await start();
      await list(GW, [hardwareOf('A1')]);
      announced.length = 0;
    });

    it('stores it and announces the hardware and the devices on it', async () => {
      setAvailability.mockResolvedValue([{ deviceId: 'd1', householdId: 'hh' }]);
      await send(`${prefix(GW)}/avail/a1`, 'offline');
      expect(setAvailability).toHaveBeenCalledWith(`${GW}:A1`, 'offline');
      expect(announced).toEqual([
        [HARDWARE_CHANGED, { hardwareId: `${GW}:A1` }],
        [DEVICE_CHANGED, { householdId: 'hh', deviceId: 'd1' }],
      ]);
    });

    it('finds hardware by its external ID, and counts an unknown one', async () => {
      findByExternalId.mockImplementation((_gateway, externalId) =>
        Promise.resolve(externalId === 'A1' ? `${GW}:A1` : undefined),
      );
      await emit(
        GW,
        { type: 'hardware.availability', ref: { externalId: 'A1' }, availability: 'online' },
        { type: 'hardware.availability', ref: { externalId: 'ZZ' }, availability: 'online' },
      );
      expect(setAvailability.mock.calls).toEqual([[`${GW}:A1`, 'online']]);
      expect(ingest.discarded.unknownName).toBe(1);
    });
  });

  describe('activity', () => {
    beforeEach(start);

    it('records a sign of life at most once a minute per gateway', async () => {
      events.emit(GATEWAY_REGISTERED, registered(OTHER));
      await ingest.idle();
      await send(`${prefix(GW)}/dev/ghost`, '{}');
      await send(`${prefix(GW)}/avail/ghost`, 'online');
      await send(`${prefix(OTHER)}/dev/ghost`, '{}');
      expect(touch.mock.calls).toEqual([
        [GW, T0],
        [OTHER, T0],
      ]);
      now = new Date(T0.getTime() + 60_000);
      await send(`${prefix(GW)}/dev/ghost`, '{}');
      expect(touch).toHaveBeenLastCalledWith(GW, now);
      expect(touch).toHaveBeenCalledTimes(3);
    });

    it('takes no retained message as a sign of life', async () => {
      await send(`${prefix(GW)}/dev/ghost`, '{}', true);
      await send(`${prefix(GW)}/avail/ghost`, 'online', true);
      expect(touch).not.toHaveBeenCalled();
      await send(`${prefix(GW)}/dev/ghost`, '{}');
      expect(touch).toHaveBeenCalledTimes(1);
    });

    it('goes on when the sign of life cannot be stored', async () => {
      await list(GW, [hardwareOf('A1')]);
      touch.mockRejectedValueOnce(new Error('payload-value'));
      await report(GW, 'a1', { soil_moisture: 1 });
      expect(handle).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(logged()).not.toContain('payload-value');
    });
  });

  describe('backpressure', () => {
    beforeEach(async () => {
      await start();
      await list(GW, [hardwareOf('A1')]);
    });

    /** Makes the processor wait until `release()`. */
    const hold = (): { release: () => void } => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      handle.mockImplementation(() => gate);
      return { release };
    };

    it('settles what it hands to the subscription only when the message is processed', async () => {
      const { release } = hold();
      const settled = vi.fn();
      void mqtt.deliver(`${prefix(GW)}/dev/a1`, '{"v":{}}').then(settled);
      await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).not.toHaveBeenCalled();

      release();
      await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    });

    it('settles also when the message could not be processed or was of no use', async () => {
      handle.mockRejectedValueOnce(new Error('payload-value'));
      await mqtt.deliver(`${prefix(GW)}/dev/a1`, '{"v":{}}');
      await mqtt.deliver(`${prefix(GW)}/dev/a1`, 'garbage');
      await mqtt.deliver(`${prefix(GW)}/dev/ghost`, '{}');
      await mqtt.deliver(`${prefix(GW)}/elsewhere`, '{}');
      expect(logged()).not.toContain('payload-value');
    });

    it('does not drop messages however many are waiting, as long as they are not too big', async () => {
      const { release } = hold();
      for (let n = 0; n < 5000; n += 1) mqtt.publish(`${prefix(GW)}/dev/a1`, '{"v":{}}');
      release();
      await ingest.idle();
      expect(handle).toHaveBeenCalledTimes(5000);
      expect(ingest.discarded.overflow).toBe(0);
    });

    it('bounds the waiting messages by their size and reports the drops once a minute', async () => {
      const { release } = hold();
      const big = JSON.stringify({ v: { text: 'x'.repeat(60_000) } });
      // 64 MiB are about 1090 of these.
      for (let n = 0; n < 1200; n += 1) mqtt.publish(`${prefix(GW)}/dev/a1`, big);
      expect(ingest.discarded.overflow).toBeGreaterThan(50);
      expect(ingest.discarded.overflow).toBeLessThan(150);
      const drops = (): string[] =>
        warn.mock.calls.map(String).filter((line) => line.includes('Dropped'));
      expect(drops()).toHaveLength(1);
      expect(drops()[0]).not.toContain('xxxx');

      now = new Date(T0.getTime() + 61_000);
      mqtt.publish(`${prefix(GW)}/dev/a1`, big);
      expect(drops()).toHaveLength(2);
      release();
      await ingest.idle();
      // What was in the queue is handled; the space is free again.
      const before = handle.mock.calls.length;
      await report(GW, 'a1', { soil_moisture: 1 });
      expect(handle).toHaveBeenCalledTimes(before + 1);
    });
  });

  describe('shutdown', () => {
    it('leaves its subscriptions to the persistent session', async () => {
      await start();
      await ingest.onModuleDestroy();
      expect(mqtt.kept).toEqual([`${prefix(GW)}/#`]);
      expect(mqtt.unsubscribed).toEqual([]);
    });

    it('processes what it has received before onModuleDestroy returns', async () => {
      await start();
      await list(GW, [hardwareOf('A1')]);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      handle.mockImplementation(() => gate);
      for (let n = 0; n < 3; n += 1) mqtt.publish(`${prefix(GW)}/dev/a1`, '{"v":{}}');
      await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));

      const destroyed = vi.fn();
      const destroying = ingest.onModuleDestroy().then(destroyed);
      expect(mqtt.filters).toEqual([]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(destroyed).not.toHaveBeenCalled();

      release();
      await destroying;
      expect(handle).toHaveBeenCalledTimes(3);
    });

    it(`waits at most ${SHUTDOWN_DRAIN_MS / 1000} s for messages that are not done`, async () => {
      vi.useFakeTimers();
      try {
        stored.set(GW, [{ id: 'hw-1', address: 'a1' }]);
        await start();
        handle.mockImplementation(() => new Promise<void>(() => undefined));
        mqtt.publish(`${prefix(GW)}/dev/a1`, '{"v":{}}');
        await vi.advanceTimersByTimeAsync(0);
        const destroyed = vi.fn();
        void ingest.onModuleDestroy().then(destroyed);
        await vi.advanceTimersByTimeAsync(SHUTDOWN_DRAIN_MS - 1);
        expect(destroyed).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(destroyed).toHaveBeenCalledTimes(1);
        expect(logged()).toContain('not handled');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not take messages any more once it is destroyed', async () => {
      await start();
      await list(GW, [hardwareOf('A1')]);
      await ingest.onModuleDestroy();
      await report(GW, 'a1', { soil_moisture: 1 });
      expect(handle).not.toHaveBeenCalled();
    });
  });
});
