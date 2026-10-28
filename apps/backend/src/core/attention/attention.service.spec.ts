import { Logger } from '@nestjs/common';
import type { Gateway } from '@smart/contracts';
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
import { GATEWAY_STATUS_CHANGED, GatewayEvents, type GatewaysService } from '../gateways/index.js';
import { ATTENTION_CHANGED, AttentionEvents, type AttentionChanged } from './attention-events.js';
import { AttentionService, TICK_MS } from './attention.service.js';

const HOUSEHOLD = 'household-1';
const GATEWAY = 'gw-aaaaaaaa';
const MINUTE = 60_000;
const START = new Date('2026-10-15T12:00:00.000Z');

const gateway = (overrides: Partial<Gateway> = {}): Gateway => ({
  id: GATEWAY,
  name: 'Pi',
  kind: 'z2m',
  topicPrefix: `gw/${GATEWAY}/z2m`,
  bridgeStatus: 'online',
  z2mStatus: 'online',
  statusChangedAt: new Date(START.getTime() - 60 * MINUTE).toISOString(),
  lastMessageAt: START.toISOString(),
  certExpiresAt: '2027-10-15T12:00:00.000Z',
  revokedAt: null,
  warnings: [],
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
  let gateways: Gateway[];
  let devices: DeviceView[];
  let unassigned: HardwareWithCapabilities[];
  const list = vi.fn<GatewaysService['list']>();
  const listActive = vi.fn<GatewaysService['listActive']>();
  const get = vi.fn<DevicesRepository['get']>();
  const listDevices = vi.fn<DevicesRepository['list']>();
  const listUnassigned = vi.fn<HardwareRepository['listUnassigned']>();
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
    for (const mock of [list, listActive, get, listDevices, listUnassigned, warn]) mock.mockReset();
    warn.mockImplementation(() => undefined);
    list.mockImplementation(() => Promise.resolve(gateways));
    listActive.mockResolvedValue([
      { id: GATEWAY, householdId: HOUSEHOLD, topicPrefix: `gw/${GATEWAY}/z2m` },
    ]);
    listDevices.mockImplementation(() => Promise.resolve(devices));
    get.mockImplementation((_household, id) => Promise.resolve(devices.find((d) => d.id === id)));
    listUnassigned.mockImplementation(() => Promise.resolve(unassigned));
    gatewayEvents = new GatewayEvents();
    deviceEvents = new DeviceEvents();
    attentionEvents = new AttentionEvents();
    changed.length = 0;
    attentionEvents.on(ATTENTION_CHANGED, (event: AttentionChanged) => changed.push(event));
    service = new AttentionService(
      {
        list,
        listActive,
        crlNextUpdate: () => Promise.resolve(undefined),
      } as unknown as GatewaysService,
      { list: listDevices, get } as unknown as DevicesRepository,
      { listUnassigned } as unknown as HardwareRepository,
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

  it('filters by role: hardware for owners, certificates for owners and platform admins', async () => {
    unassigned = [
      {
        id: 'hw-1',
        gatewayId: GATEWAY,
        friendlyName: 'New',
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
        list,
        listActive,
        crlNextUpdate: () => Promise.resolve(undefined),
      } as unknown as GatewaysService,
      { list: listDevices, get } as unknown as DevicesRepository,
      { listUnassigned } as unknown as HardwareRepository,
      new GatewayEvents(),
      new DeviceEvents(),
      new AttentionEvents(),
      () => now,
    );
    let release: (gateways: Gateway[]) => void = () => undefined;
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
      { id: GATEWAY, householdId: HOUSEHOLD, topicPrefix: `gw/${GATEWAY}/z2m` },
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
