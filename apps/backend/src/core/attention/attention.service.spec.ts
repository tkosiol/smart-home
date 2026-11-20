import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_STATE_CHANGED,
  DEVICE_THRESHOLDS_CHANGED,
  DeviceEvents,
  type DevicesRepository,
  type DeviceView,
  type HardwareRepository,
  type HardwareWithCapabilities,
} from '../devices/index.js';
import {
  GATEWAY_STATUS_CHANGED,
  GatewayEvents,
  type GatewaysService,
  type RegisteredGateway,
} from '../gateways/index.js';
import type { MeasurementsRepository } from '../telemetry/index.js';
import { ATTENTION_CHANGED, AttentionEvents, type AttentionChanged } from './attention-events.js';
import { AttentionService, SINCE_LOOKBACK_MS, TICK_MS } from './attention.service.js';

const HOUSEHOLD = 'household-1';
const GATEWAY = 'gw-aaaaaaaa';
const MINUTE = 60_000;
const START = new Date('2026-10-15T12:00:00.000Z');

const gateway = (overrides: Partial<RegisteredGateway> = {}): RegisteredGateway => ({
  id: GATEWAY,
  name: 'Pi',
  kind: 'z2m',
  auth: 'certificate',
  topicPrefix: `gw/${GATEWAY}/z2m`,
  bridgeStatus: 'online',
  serviceStatus: 'online',
  statusChangedAt: new Date(START.getTime() - 60 * MINUTE).toISOString(),
  lastMessageAt: START.toISOString(),
  certExpiresAt: '2027-10-15T12:00:00.000Z',
  credentialGeneration: null,
  revokedAt: null,
  warnings: [],
  registeredAt: new Date(START.getTime() - 24 * 60 * MINUTE),
  ...overrides,
});

const view = (id: string, state: Record<string, unknown>, rest: Partial<DeviceView> = {}) =>
  ({
    id,
    name: `Plant ${id}`,
    icon: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    hardware: { id: `hw-${id}`, vendor: '', model: '', description: null },
    gatewayId: GATEWAY,
    availability: 'online',
    lastSeenAt: START,
    state,
    capabilities: [],
    kind: 'soil',
    thresholds: {},
    ...rest,
  }) satisfies DeviceView;

describe('AttentionService', () => {
  let now: Date;
  let gateways: RegisteredGateway[];
  let devices: DeviceView[];
  let unassigned: HardwareWithCapabilities[];
  const list = vi.fn<GatewaysService['listRegistered']>();
  const listActive = vi.fn<GatewaysService['listActive']>();
  const get = vi.fn<DevicesRepository['get']>();
  const listDevices = vi.fn<DevicesRepository['list']>();
  const listUnassigned = vi.fn<HardwareRepository['listUnassigned']>();
  const runStart = vi.fn<MeasurementsRepository['runStart']>();
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  let gatewayEvents: GatewayEvents;
  let deviceEvents: DeviceEvents;
  let attentionEvents: AttentionEvents;
  const changed: AttentionChanged[] = [];
  let service: AttentionService;

  const items = (role: 'owner' | 'member' | 'viewer' = 'owner', admin = false) =>
    service.list(HOUSEHOLD, role, admin);
  const ids = (role: 'owner' | 'member' | 'viewer' = 'owner', admin = false) =>
    items(role, admin).map((item) => item.id);

  beforeEach(async () => {
    vi.useFakeTimers();
    now = START;
    gateways = [gateway()];
    devices = [view('d1', { soil_moisture: 60 })];
    unassigned = [];
    for (const mock of [list, listActive, get, listDevices, listUnassigned, runStart, warn])
      mock.mockReset();
    warn.mockImplementation(() => undefined);
    list.mockImplementation(() => Promise.resolve(gateways));
    listActive.mockResolvedValue([
      { id: GATEWAY, householdId: HOUSEHOLD, kind: 'z2m', topicPrefix: `gw/${GATEWAY}/z2m` },
    ]);
    listDevices.mockImplementation(() => Promise.resolve(devices));
    get.mockImplementation((_household, id) => Promise.resolve(devices.find((d) => d.id === id)));
    listUnassigned.mockImplementation(() => Promise.resolve(unassigned));
    runStart.mockResolvedValue(null);
    gatewayEvents = new GatewayEvents();
    deviceEvents = new DeviceEvents();
    attentionEvents = new AttentionEvents();
    changed.length = 0;
    attentionEvents.on(ATTENTION_CHANGED, (event: AttentionChanged) => changed.push(event));
    service = new AttentionService(
      {
        listRegistered: list,
        listActive,
        crlNextUpdate: () => Promise.resolve(undefined),
      } as unknown as GatewaysService,
      { list: listDevices, get } as unknown as DevicesRepository,
      { listUnassigned } as unknown as HardwareRepository,
      { runStart } as unknown as MeasurementsRepository,
      gatewayEvents,
      deviceEvents,
      attentionEvents,
      () => now,
    );
    service.onModuleInit();
    await service.idle();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('computes the items of every household with a gateway at start', () => {
    expect(ids()).toEqual([]);
    expect(listActive).toHaveBeenCalledTimes(1);
  });

  describe('attention.changed', () => {
    it('announces a new list and stays quiet when a recomputation changes nothing', async () => {
      devices = [view('d1', { soil_moisture: 10 })];
      deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' });
      await service.idle();
      expect(changed).toEqual([{ householdId: HOUSEHOLD }]);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      await service.idle();
      expect(ids()).toEqual(['soil_dry:d1']);
      expect(changed).toHaveLength(1);
    });

    it('announces a household that became empty once, and not again', async () => {
      devices = [view('d1', { soil_moisture: 10 })];
      deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' });
      await service.idle();
      changed.length = 0;
      gateways = [];
      devices = [];
      gatewayEvents.emit(GATEWAY_STATUS_CHANGED, { gatewayId: GATEWAY });
      await service.idle();
      expect(changed).toEqual([{ householdId: HOUSEHOLD }]);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      await service.idle();
      expect(changed).toHaveLength(1);
    });

    it('is not held up by a listener that throws', async () => {
      attentionEvents.on(ATTENTION_CHANGED, () => {
        throw new Error('listener failed');
      });
      devices = [view('d1', { soil_moisture: 10 })];
      deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' });
      await service.idle();
      expect(ids()).toEqual(['soil_dry:d1']);
      expect(warn).toHaveBeenCalled();
    });
  });

  it('recomputes a device after it reported', async () => {
    devices = [view('d1', { soil_moisture: 10 })];
    deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' });
    await service.idle();
    expect(ids()).toEqual(['soil_dry:d1']);
    expect(get).toHaveBeenCalledWith(HOUSEHOLD, 'd1');
  });

  it('recomputes a device after its thresholds changed', async () => {
    devices = [view('d1', { soil_moisture: 30 }, { thresholds: { soilMoistureMin: 40 } })];
    deviceEvents.emit(DEVICE_THRESHOLDS_CHANGED, { householdId: HOUSEHOLD, deviceId: 'd1' });
    await service.idle();
    expect(ids()).toEqual(['soil_dry:d1']);
  });

  it('answers many reports of one device with one read', async () => {
    devices = [view('d1', { soil_moisture: 10 })];
    for (let count = 0; count < 5; count += 1) {
      deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' });
    }
    await service.idle();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('recomputes the household after a gateway changed status', async () => {
    gateways = [
      gateway({
        bridgeStatus: 'offline',
        statusChangedAt: new Date(START.getTime() - 9 * MINUTE).toISOString(),
      }),
    ];
    gatewayEvents.emit(GATEWAY_STATUS_CHANGED, { gatewayId: GATEWAY });
    await service.idle();
    expect(ids()).toEqual([`gateway_offline:${GATEWAY}`]);
  });

  it('brings up the time conditions with the tick', async () => {
    gateways = [gateway({ bridgeStatus: 'offline', statusChangedAt: START.toISOString() })];
    gatewayEvents.emit(GATEWAY_STATUS_CHANGED, { gatewayId: GATEWAY });
    await service.idle();
    expect(ids()).toEqual([]);

    now = new Date(START.getTime() + 5 * MINUTE);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    await service.idle();
    expect(ids()).toEqual([`gateway_offline:${GATEWAY}`]);
  });

  it('keeps since while the item exists across recomputations', async () => {
    devices = [view('d1', { soil_moisture: 10 })];
    await service.recomputeHousehold(HOUSEHOLD);
    const first = items()[0]?.since;
    now = new Date(START.getTime() + 10 * MINUTE);
    devices = [view('d1', { soil_moisture: 12 }, { lastSeenAt: now })];
    await service.recomputeDevice(HOUSEHOLD, 'd1');
    expect(items()[0]?.since).toBe(first);
    expect(items()[0]?.value).toBe(12);
  });

  describe('what a silent phase does not reset (#39)', () => {
    it('keeps a dry plant dry over a silent phase and a report inside the margin', async () => {
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      const since = items()[0]?.since;

      now = new Date(START.getTime() + 3 * 60 * MINUTE);
      devices = [view('d1', { soil_moisture: 10 }, { availability: 'offline' })];
      await service.recomputeDevice(HOUSEHOLD, 'd1');
      expect(ids()).toEqual(['device_silent:d1']);

      devices = [view('d1', { soil_moisture: 26 }, { lastSeenAt: now })];
      await service.recomputeDevice(HOUSEHOLD, 'd1');
      expect(ids()).toEqual(['soil_dry:d1']);
      expect(items()[0]?.since).toBe(since);

      devices = [view('d1', { soil_moisture: 29 }, { lastSeenAt: now })];
      await service.recomputeDevice(HOUSEHOLD, 'd1');
      expect(ids()).toEqual([]);
    });

    it('keeps it over an outage of the gateway, too', async () => {
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      gateways = [
        gateway({
          bridgeStatus: 'offline',
          statusChangedAt: new Date(START.getTime() - 9 * MINUTE).toISOString(),
        }),
      ];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(ids()).toEqual([`gateway_offline:${GATEWAY}`]);
      gateways = [gateway()];
      devices = [view('d1', { soil_moisture: 26 })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(ids()).toEqual(['soil_dry:d1']);
    });
  });

  describe('a gateway nothing was ever heard from', () => {
    const unheard = (registeredMinutesAgo: number) =>
      gateway({
        bridgeStatus: 'unknown',
        serviceStatus: 'unknown',
        statusChangedAt: null,
        lastMessageAt: null,
        registeredAt: new Date(START.getTime() - registeredMinutesAgo * MINUTE),
      });

    it('is reported 5 minutes after its registration, with since at the registration', async () => {
      gateways = [unheard(0)];
      devices = [view('d1', { soil_moisture: 60 }, { availability: 'offline' })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(ids()).toEqual([]);

      now = new Date(START.getTime() + 5 * MINUTE);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      await service.idle();
      expect(ids()).toEqual([`gateway_offline:${GATEWAY}`]);
      expect(items()[0]?.since).toBe(START.toISOString());
    });

    it('is reported at once after a restart, from the stored registration time', async () => {
      gateways = [unheard(10)];
      const restarted = new AttentionService(
        { listRegistered: list, listActive } as unknown as GatewaysService,
        { list: listDevices, get } as unknown as DevicesRepository,
        { listUnassigned } as unknown as HardwareRepository,
        { runStart } as unknown as MeasurementsRepository,
        new GatewayEvents(),
        new DeviceEvents(),
        new AttentionEvents(),
        () => now,
      );
      await restarted.recomputeHousehold(HOUSEHOLD);
      const [item] = restarted.list(HOUSEHOLD, 'owner', false);
      expect(item).toMatchObject({ id: `gateway_offline:${GATEWAY}` });
      expect(item?.since).toBe(new Date(START.getTime() - 10 * MINUTE).toISOString());
    });
  });

  describe('since from the stored readings (#99)', () => {
    const tenMinutesAgo = new Date(START.getTime() - 10 * MINUTE).toISOString();
    /** A service that has not computed anything yet: the first computation after a start. */
    const restarted = (): AttentionService =>
      new AttentionService(
        { listRegistered: list, listActive } as unknown as GatewaysService,
        { list: listDevices, get } as unknown as DevicesRepository,
        { listUnassigned } as unknown as HardwareRepository,
        { runStart } as unknown as MeasurementsRepository,
        new GatewayEvents(),
        new DeviceEvents(),
        new AttentionEvents(),
        () => now,
      );
    const DAYS_AGO = new Date(START.getTime() - 4 * 24 * 60 * MINUTE);

    it('starts a dry plant at the first reading of its run, not at the last report', async () => {
      runStart.mockImplementation((_device, capability) =>
        Promise.resolve(capability === 'soil_moisture' ? DAYS_AGO : null),
      );
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(items()[0]).toMatchObject({ id: 'soil_dry:d1', since: DAYS_AGO.toISOString() });
      expect(runStart).toHaveBeenCalledWith(
        'd1',
        'soil_moisture',
        25,
        28,
        new Date(START.getTime() - SINCE_LOOKBACK_MS),
      );
    });

    it('does the same for a low battery, with its own margin', async () => {
      runStart.mockImplementation((_device, capability) =>
        Promise.resolve(capability === 'battery' ? DAYS_AGO : null),
      );
      devices = [view('d1', { battery: 4 })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(items()[0]).toMatchObject({ id: 'battery_low:d1', since: DAYS_AGO.toISOString() });
      expect(runStart).toHaveBeenCalledWith('d1', 'battery', 20, 25, expect.any(Date));
    });

    it('asks once for an item that stays, and not at all for one that exists already', async () => {
      runStart.mockResolvedValue(DAYS_AGO);
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      await service.recomputeHousehold(HOUSEHOLD);
      await service.recomputeDevice(HOUSEHOLD, 'd1');
      expect(runStart).toHaveBeenCalledTimes(1);
      expect(items()[0]?.since).toBe(DAYS_AGO.toISOString());
    });

    it('does not ask for a healthy device', async () => {
      devices = [view('d1', { soil_moisture: 60, battery: 90 })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(runStart).not.toHaveBeenCalled();
    });

    it('falls back to the last report when there is no reading', async () => {
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(items()[0]?.since).toBe(START.toISOString());
    });

    it('logs a failing lookup and still computes the items', async () => {
      runStart.mockRejectedValueOnce(new Error('database down'));
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(ids()).toEqual(['soil_dry:d1']);
      expect(items()[0]?.since).toBe(START.toISOString());
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cannot read the start'));
    });

    it('keeps a plant dry whose stored run is still open although it reads inside the margin', async () => {
      runStart.mockResolvedValue(DAYS_AGO);
      devices = [view('d1', { soil_moisture: 26 })];
      const after = restarted();
      await after.recomputeHousehold(HOUSEHOLD);
      expect(after.list(HOUSEHOLD, 'owner', false)[0]).toMatchObject({
        id: 'soil_dry:d1',
        since: DAYS_AGO.toISOString(),
      });
      expect(runStart).toHaveBeenCalledWith('d1', 'soil_moisture', 25, 28, expect.any(Date));
    });

    it('shows nothing for a reading inside the margin without an open run', async () => {
      devices = [view('d1', { soil_moisture: 26, battery: 22 })];
      const after = restarted();
      await after.recomputeHousehold(HOUSEHOLD);
      expect(after.list(HOUSEHOLD, 'owner', false)).toEqual([]);
    });

    it('does not ask for a reading beyond the margin', async () => {
      devices = [view('d1', { soil_moisture: 28, battery: 25 })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(runStart).not.toHaveBeenCalled();
    });

    it('asks once for a condition that holds without a visible item, over many ticks', async () => {
      gateways = [gateway({ bridgeStatus: 'offline', statusChangedAt: tenMinutesAgo })];
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      for (let tick = 0; tick < 3; tick += 1) {
        await vi.advanceTimersByTimeAsync(TICK_MS);
        await service.idle();
      }
      expect(runStart).toHaveBeenCalledTimes(1);
    });

    it('asks again when the threshold changes, or when the reading crosses it', async () => {
      gateways = [gateway({ bridgeStatus: 'offline', statusChangedAt: tenMinutesAgo })];
      devices = [view('d1', { soil_moisture: 26 })];
      const after = restarted();
      await after.recomputeHousehold(HOUSEHOLD);
      devices = [view('d1', { soil_moisture: 10 })];
      await after.recomputeHousehold(HOUSEHOLD);
      devices = [view('d1', { soil_moisture: 10 }, { thresholds: { soilMoistureMin: 40 } })];
      await after.recomputeHousehold(HOUSEHOLD);
      expect(runStart).toHaveBeenCalledTimes(3);
    });

    it('does not revive a run when the threshold is raised over a reading inside the new margin', async () => {
      // Readings below 25 exist (22 %), but the plant was no problem under its minimum of 20.
      runStart.mockResolvedValue(DAYS_AGO);
      devices = [view('d1', { soil_moisture: 22 }, { thresholds: { soilMoistureMin: 20 } })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(ids()).toEqual([]);

      devices = [view('d1', { soil_moisture: 26 }, { thresholds: { soilMoistureMin: 25 } })];
      deviceEvents.emit(DEVICE_THRESHOLDS_CHANGED, { householdId: HOUSEHOLD, deviceId: 'd1' });
      await service.idle();
      expect(ids()).toEqual([]);
      devices = [view('d1', { soil_moisture: 26 }, { thresholds: { soilMoistureMin: 25 } })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(ids()).toEqual([]);
    });

    it('does the same for the battery', async () => {
      runStart.mockResolvedValue(DAYS_AGO);
      devices = [view('d1', { battery: 18 }, { thresholds: { batteryMin: 15 } })];
      await service.recomputeHousehold(HOUSEHOLD);
      devices = [view('d1', { battery: 22 }, { thresholds: { batteryMin: 20 } })];
      await service.recomputeDevice(HOUSEHOLD, 'd1');
      expect(ids()).toEqual([]);
    });

    it('forgets what it asked when the device is healthy again', async () => {
      gateways = [gateway({ bridgeStatus: 'offline', statusChangedAt: tenMinutesAgo })];
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      devices = [view('d1', { soil_moisture: 60 })];
      await service.recomputeHousehold(HOUSEHOLD);
      devices = [view('d1', { soil_moisture: 10 })];
      await service.recomputeHousehold(HOUSEHOLD);
      expect(runStart).toHaveBeenCalledTimes(2);
    });
  });

  it('filters by role: hardware for owners, certificates for owners and platform admins', async () => {
    unassigned = [
      {
        id: 'hw-1',
        gatewayId: GATEWAY,
        name: 'New',
        firstSeenAt: START,
      } as HardwareWithCapabilities,
    ];
    gateways = [gateway({ warnings: ['certExpiring'] })];
    await service.recomputeHousehold(HOUSEHOLD);

    expect(ids('owner')).toEqual(
      expect.arrayContaining(['hardware_new:hw-1', `cert_expiring:${GATEWAY}`]),
    );
    expect(ids('member')).toEqual([]);
    expect(ids('viewer')).toEqual([]);
    expect(ids('viewer', true)).toEqual([`cert_expiring:${GATEWAY}`]);
    expect(ids('member', true)).toEqual([`cert_expiring:${GATEWAY}`]);
  });

  it('shows everything else to a viewer', async () => {
    devices = [view('d1', { soil_moisture: 10, battery: 3 })];
    await service.recomputeHousehold(HOUSEHOLD);
    expect(ids('viewer').sort()).toEqual(['battery_low:d1', 'soil_dry:d1']);
  });

  it('leaves out gateways that are revoked and the devices behind them', async () => {
    gateways = [gateway({ revokedAt: START.toISOString() })];
    devices = [view('d1', { soil_moisture: 1 })];
    await service.recomputeHousehold(HOUSEHOLD);
    expect(ids()).toEqual([]);
  });

  it('does not let the start-up read overwrite a newer recomputation', async () => {
    const first = new AttentionService(
      {
        listRegistered: list,
        listActive,
        crlNextUpdate: () => Promise.resolve(undefined),
      } as unknown as GatewaysService,
      { list: listDevices, get } as unknown as DevicesRepository,
      { listUnassigned } as unknown as HardwareRepository,
      { runStart } as unknown as MeasurementsRepository,
      new GatewayEvents(),
      new DeviceEvents(),
      new AttentionEvents(),
      () => now,
    );
    let release: (gateways: RegisteredGateway[]) => void = () => undefined;
    list.mockReset();
    list.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    list.mockImplementation(() => Promise.resolve(gateways));
    first.onModuleInit();
    const recomputed = first.recomputeHousehold(HOUSEHOLD);
    gateways = [
      gateway({
        bridgeStatus: 'offline',
        statusChangedAt: new Date(START.getTime() - 9 * MINUTE).toISOString(),
      }),
    ];
    await vi.advanceTimersByTimeAsync(0);
    release([gateway()]);
    await recomputed;
    await first.idle();
    expect(first.list(HOUSEHOLD, 'owner', false).map((item) => item.kind)).toEqual([
      'gateway_offline',
    ]);
    first.onModuleDestroy();
  });

  it('ignores a device whose gateway is not active', async () => {
    devices = [view('d1', { soil_moisture: 10 })];
    await service.recomputeHousehold(HOUSEHOLD);
    expect(ids()).toEqual(['soil_dry:d1']);
    devices = [view('d1', { soil_moisture: 10 }, { gatewayId: 'gw-revoked' })];
    await service.recomputeDevice(HOUSEHOLD, 'd1');
    expect(ids()).toEqual([]);
  });

  it('keeps no state for a household that has nothing left, and does not reload it', async () => {
    gateways = [gateway({ revokedAt: START.toISOString() })];
    devices = [];
    listActive.mockResolvedValue([]);
    await service.recomputeHousehold(HOUSEHOLD);
    expect(items()).toEqual([]);
    expect((service as unknown as { households: Map<string, unknown> }).households.size).toBe(0);

    list.mockClear();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    await service.idle();
    expect(list).not.toHaveBeenCalled();

    // Asked for again, it is computed on demand.
    gateways = [gateway()];
    listActive.mockResolvedValue([
      { id: GATEWAY, householdId: HOUSEHOLD, kind: 'z2m', topicPrefix: `gw/${GATEWAY}/z2m` },
    ]);
    await service.ensureComputed(HOUSEHOLD);
    expect(list).toHaveBeenCalledTimes(1);
    expect((service as unknown as { households: Map<string, unknown> }).households.size).toBe(1);
  });

  it('finds the household of a device and a gateway without scanning, and forgets them', async () => {
    devices = [view('d1', { soil_moisture: 60 })];
    await service.recomputeHousehold(HOUSEHOLD);
    const lookups = service as unknown as {
      deviceHouseholds: Map<string, string>;
      gatewayHouseholds: Map<string, string>;
    };
    expect(lookups.deviceHouseholds.get('d1')).toBe(HOUSEHOLD);
    expect(lookups.gatewayHouseholds.get(GATEWAY)).toBe(HOUSEHOLD);

    devices = [];
    gateways = [];
    await service.recomputeHousehold(HOUSEHOLD);
    expect(lookups.deviceHouseholds.size).toBe(0);
    expect(lookups.gatewayHouseholds.size).toBe(0);
  });

  it('says nothing for devices while their gateway is not offline for long enough', async () => {
    gateways = [
      gateway({
        bridgeStatus: 'offline',
        statusChangedAt: new Date(START.getTime() - 3 * MINUTE).toISOString(),
      }),
    ];
    devices = Array.from({ length: 12 }, (_, index) =>
      view(`d${index}`, { soil_moisture: 60 }, { availability: 'offline' }),
    );
    await service.recomputeHousehold(HOUSEHOLD);
    expect(items()).toEqual([]);
  });

  describe('a failing recomputation', () => {
    it('does not reach the emitter of a device event', async () => {
      get.mockRejectedValue(new Error('database down'));
      expect(() => deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' })).not.toThrow();
      await service.idle();
      expect(warn).toHaveBeenCalled();
    });

    it('does not reach the emitter of a threshold or a gateway event', async () => {
      get.mockRejectedValue(new Error('database down'));
      list.mockRejectedValue(new Error('database down'));
      expect(() =>
        deviceEvents.emit(DEVICE_THRESHOLDS_CHANGED, { householdId: HOUSEHOLD, deviceId: 'd1' }),
      ).not.toThrow();
      expect(() =>
        gatewayEvents.emit(GATEWAY_STATUS_CHANGED, { gatewayId: GATEWAY }),
      ).not.toThrow();
      await service.idle();
      expect(warn).toHaveBeenCalled();
    });

    it('does not reach the emitter when handling the event fails at once', () => {
      // Handled synchronously: the listener itself must not throw either.
      vi.spyOn(
        (service as unknown as { deviceHouseholds: Map<string, string> }).deviceHouseholds,
        'get',
      ).mockImplementation(() => {
        throw new Error('broken');
      });
      expect(() => deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' })).not.toThrow();
      expect(warn).toHaveBeenCalled();
    });

    it('carries on with the next recomputation and does not log the error text', async () => {
      get.mockRejectedValueOnce(new Error('secret-value-42'));
      deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' });
      await service.idle();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-value-42');
      devices = [view('d1', { soil_moisture: 10 })];
      deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: 'd1' });
      await service.idle();
      expect(ids()).toEqual(['soil_dry:d1']);
    });

    it('survives a failing start and tick', async () => {
      listActive.mockRejectedValue(new Error('down'));
      const fresh = new AttentionService(
        { list, listActive } as unknown as GatewaysService,
        { list: listDevices, get } as unknown as DevicesRepository,
        { listUnassigned } as unknown as HardwareRepository,
        { runStart } as unknown as MeasurementsRepository,
        new GatewayEvents(),
        new DeviceEvents(),
        new AttentionEvents(),
        () => now,
      );
      expect(() => fresh.onModuleInit()).not.toThrow();
      await vi.advanceTimersByTimeAsync(TICK_MS);
      await fresh.idle();
      fresh.onModuleDestroy();
      expect(warn).toHaveBeenCalled();
    });
  });
});
