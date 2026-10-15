import {
  attentionItemSchema,
  effectiveThresholds,
  type AttentionItem,
  type AttentionKind,
  type Thresholds,
} from '@smart/contracts';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  NOTHING_BEFORE,
  openContacts,
  type DeviceSnapshot,
  type GatewaySnapshot,
  type Previous,
  type Snapshot,
} from './attention.rules.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date('2026-10-15T12:00:00.000Z');
const ago = (ms: number, from = NOW): Date => new Date(from.getTime() - ms);

const gateway = (overrides: Partial<GatewaySnapshot> = {}): GatewaySnapshot => ({
  id: 'gw-aaaaaaaa',
  name: 'Pi',
  bridgeStatus: 'online',
  z2mStatus: 'online',
  statusChangedAt: ago(HOUR),
  lastMessageAt: ago(MINUTE),
  certExpiresAt: new Date('2027-10-15T12:00:00.000Z'),
  warnings: [],
  ...overrides,
});

const device = (
  overrides: Partial<Omit<DeviceSnapshot, 'thresholds'>> & { own?: Thresholds } = {},
): DeviceSnapshot => {
  const { own, ...rest } = overrides;
  const kind = rest.kind ?? 'soil';
  return {
    id: 'dev-1',
    name: 'Ficus',
    gatewayId: 'gw-aaaaaaaa',
    kind,
    thresholds: effectiveThresholds(kind, own),
    availability: 'online',
    lastSeenAt: ago(MINUTE),
    createdAt: ago(30 * 24 * HOUR),
    state: {},
    ...rest,
  };
};

const snapshot = (parts: Partial<Snapshot> = {}): Snapshot => ({
  gateways: [gateway()],
  devices: [],
  hardware: [],
  crlNextUpdate: null,
  ...parts,
});

const run = (parts: Partial<Snapshot>, previous: Previous = NOTHING_BEFORE, now = NOW) =>
  evaluate(snapshot(parts), previous, now);
const kinds = (items: AttentionItem[]): AttentionKind[] => items.map((item) => item.kind);
const withState = (state: Record<string, unknown>, rest: Parameters<typeof device>[0] = {}) =>
  device({ state, ...rest });

describe('evaluate', () => {
  it('yields nothing for a healthy household', () => {
    const healthy = withState({ soil_moisture: 60, battery: 90, dry: false });
    expect(run({ devices: [healthy] })).toEqual([]);
  });

  it('produces items that match the contract', () => {
    const items = run({
      devices: [withState({ soil_moisture: 10, battery: 5 })],
      hardware: [{ id: 'hw-1', gatewayId: 'gw-aaaaaaaa', name: 'New', firstSeenAt: ago(HOUR) }],
    });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(() => attentionItemSchema.parse(item)).not.toThrow();
  });

  describe('soil_dry', () => {
    const dryAt = (moisture: number, previous: Previous = NOTHING_BEFORE) =>
      kinds(run({ devices: [withState({ soil_moisture: moisture })] }, previous));

    it('starts below the lower threshold, not at it', () => {
      expect(dryAt(25)).toEqual([]);
      expect(dryAt(24.9)).toEqual(['soil_dry']);
    });

    it('follows the device threshold', () => {
      const own = { soilMoistureMin: 40 };
      expect(kinds(run({ devices: [withState({ soil_moisture: 39 }, { own })] }))).toEqual([
        'soil_dry',
      ]);
      expect(kinds(run({ devices: [withState({ soil_moisture: 41 }, { own })] }))).toEqual([]);
    });

    it('fires on the dry flag whatever the moisture', () => {
      const [item] = run({ devices: [withState({ soil_moisture: 60, dry: true })] });
      expect(item).toMatchObject({ kind: 'soil_dry', severity: 'warning', value: 60, unit: '%' });
      expect(item?.params).toMatchObject({ dryFlag: true });
    });

    it('fires on the dry flag without a moisture value', () => {
      const [item] = run({ devices: [withState({ dry: true })] });
      expect(item?.kind).toBe('soil_dry');
      expect(item?.value).toBeUndefined();
    });

    it('is off for a kind without a lower threshold', () => {
      const other = device({ kind: 'climate', state: { soil_moisture: 1 } });
      expect(run({ devices: [other] })).toEqual([]);
    });

    it('does not flip at 26 % once dry, and ends only at 28 %', () => {
      const first = run({ devices: [withState({ soil_moisture: 24 })] });
      expect(kinds(first)).toEqual(['soil_dry']);
      const at26 = run({ devices: [withState({ soil_moisture: 26 })] }, { items: first });
      expect(kinds(at26)).toEqual(['soil_dry']);
      const again = run({ devices: [withState({ soil_moisture: 24 })] }, { items: at26 });
      expect(again).toEqual(first);
      expect(
        kinds(run({ devices: [withState({ soil_moisture: 27.9 })] }, { items: again })),
      ).toEqual(['soil_dry']);
      expect(run({ devices: [withState({ soil_moisture: 28 })] }, { items: again })).toEqual([]);
    });

    it('does not start at 26 % without having been dry', () => {
      expect(dryAt(26)).toEqual([]);
    });
  });

  describe('soil_wet', () => {
    const own = { soilMoistureMax: 80 };
    const wetAt = (moisture: number, previous: Previous = NOTHING_BEFORE) =>
      kinds(run({ devices: [withState({ soil_moisture: moisture }, { own })] }, previous));

    it('is off while no upper threshold is set', () => {
      expect(kinds(run({ devices: [withState({ soil_moisture: 100 })] }))).toEqual([]);
    });

    it('starts above the upper threshold, not at it', () => {
      expect(wetAt(80)).toEqual([]);
      expect(wetAt(80.1)).toEqual(['soil_wet']);
    });

    it('ends only 3 points below the threshold', () => {
      const first = run({ devices: [withState({ soil_moisture: 85 }, { own })] });
      expect(wetAt(78, { items: first })).toEqual(['soil_wet']);
      expect(wetAt(77.1, { items: first })).toEqual(['soil_wet']);
      expect(wetAt(77, { items: first })).toEqual([]);
    });
  });

  describe('battery_low', () => {
    const batteryAt = (battery: number, previous: Previous = NOTHING_BEFORE) =>
      kinds(run({ devices: [withState({ battery })] }, previous));

    it('starts below the threshold, not at it', () => {
      expect(batteryAt(20)).toEqual([]);
      expect(batteryAt(19)).toEqual(['battery_low']);
    });

    it('ends only 5 points above the threshold', () => {
      const first = run({ devices: [withState({ battery: 19 })] });
      expect(batteryAt(24, { items: first })).toEqual(['battery_low']);
      expect(batteryAt(25, { items: first })).toEqual([]);
    });

    it('follows the device threshold', () => {
      const own = { batteryMin: 50 };
      expect(kinds(run({ devices: [withState({ battery: 49 }, { own })] }))).toEqual([
        'battery_low',
      ]);
    });

    it('reports value and unit', () => {
      expect(run({ devices: [withState({ battery: 7 })] })[0]).toMatchObject({
        value: 7,
        unit: '%',
        severity: 'warning',
      });
    });
  });

  describe('contact_open', () => {
    const contactDevice = (state: Record<string, unknown>, lastSeenAt: Date | null) =>
      device({ kind: 'contact', state, lastSeenAt });
    const openFor = (minutes: number) => {
      const opened = ago(minutes * MINUTE);
      return run({ devices: [contactDevice({ contact: false }, opened)] });
    };

    it('starts when open for the threshold, not before', () => {
      expect(openFor(9.9)).toEqual([]);
      const [item] = openFor(10);
      expect(item).toMatchObject({ kind: 'contact_open', severity: 'info' });
      expect(item?.since).toBe(ago(10 * MINUTE).toISOString());
    });

    it('is off while closed', () => {
      expect(run({ devices: [contactDevice({ contact: true }, ago(HOUR))] })).toEqual([]);
    });

    it('counts from when the contact was first seen open, not from a later report', () => {
      const openedAt = ago(8 * MINUTE);
      const sameSnapshot = snapshot({
        devices: [contactDevice({ contact: false, battery: 90 }, ago(MINUTE))],
      });
      const memory = new Map([['dev-1', openedAt]]);
      const items = evaluate(sameSnapshot, { items: [], contactOpenSince: memory }, NOW);
      expect(items).toEqual([]);
      const later = new Date(NOW.getTime() + 2 * MINUTE);
      const [item] = evaluate(sameSnapshot, { items: [], contactOpenSince: memory }, later);
      expect(item?.since).toBe(openedAt.toISOString());
    });

    it('forgets the open time when the contact closes', () => {
      const open = snapshot({ devices: [contactDevice({ contact: false }, ago(HOUR))] });
      const memory = openContacts(open, NOTHING_BEFORE, NOW);
      expect(memory.get('dev-1')).toEqual(ago(HOUR));
      const closed = snapshot({ devices: [contactDevice({ contact: true }, ago(MINUTE))] });
      expect(openContacts(closed, { items: [], contactOpenSince: memory }, NOW).size).toBe(0);
    });

    it('follows the device threshold', () => {
      const own = { contactOpenMinutes: 30 };
      const open = device({
        kind: 'contact',
        own,
        state: { contact: false },
        lastSeenAt: ago(HOUR),
      });
      expect(kinds(run({ devices: [open] }))).toEqual(['contact_open']);
      const brief = device({
        kind: 'contact',
        own,
        state: { contact: false },
        lastSeenAt: ago(20 * MINUTE),
      });
      expect(run({ devices: [brief] })).toEqual([]);
    });
  });

  describe('device_silent', () => {
    it('starts after the silent threshold of 2 h, not before', () => {
      expect(run({ devices: [device({ lastSeenAt: ago(2 * HOUR - 1) })] })).toEqual([]);
      const [item] = run({ devices: [device({ lastSeenAt: ago(2 * HOUR) })] });
      expect(item).toMatchObject({ kind: 'device_silent', severity: 'critical' });
      expect(item?.since).toBe(ago(2 * HOUR).toISOString());
      expect(item?.params).toMatchObject({ reason: 'no_message' });
    });

    it('fires at once when the hardware is unavailable', () => {
      const [item] = run({ devices: [device({ availability: 'offline' })] });
      expect(item).toMatchObject({ kind: 'device_silent', params: { reason: 'unavailable' } });
    });

    it('does not fire for an unknown availability', () => {
      expect(run({ devices: [device({ availability: 'unknown' })] })).toEqual([]);
    });

    it('counts from the creation of a device that never reported', () => {
      const fresh = device({ lastSeenAt: null, createdAt: ago(MINUTE) });
      expect(run({ devices: [fresh] })).toEqual([]);
      const old = device({ lastSeenAt: null, createdAt: ago(3 * HOUR) });
      expect(kinds(run({ devices: [old] }))).toEqual(['device_silent']);
    });

    it('follows the device threshold', () => {
      const own = { silentMinutes: 10 };
      expect(kinds(run({ devices: [device({ own, lastSeenAt: ago(10 * MINUTE) })] }))).toEqual([
        'device_silent',
      ]);
    });

    it('is the own item of a device behind an online gateway', () => {
      const items = run({
        devices: [device({ id: 'quiet', availability: 'offline' }), device({ id: 'fine' })],
      });
      expect(items.map((item) => item.id)).toEqual(['device_silent:quiet']);
    });
  });

  describe('gateway_offline', () => {
    const offlineSince = (minutes: number, rest: Partial<GatewaySnapshot> = {}) =>
      gateway({ bridgeStatus: 'offline', statusChangedAt: ago(minutes * MINUTE), ...rest });

    it('starts after 5 minutes without being online, not before', () => {
      expect(run({ gateways: [offlineSince(4.9)] })).toEqual([]);
      const [item] = run({ gateways: [offlineSince(5)] });
      expect(item).toMatchObject({
        id: 'gateway_offline:gw-aaaaaaaa',
        kind: 'gateway_offline',
        severity: 'critical',
        gatewayId: 'gw-aaaaaaaa',
        name: 'Pi',
      });
      expect(item?.since).toBe(ago(5 * MINUTE).toISOString());
    });

    it('also fires when only the Zigbee2MQTT side is not online', () => {
      const z2m = gateway({ z2mStatus: 'offline', statusChangedAt: ago(10 * MINUTE) });
      expect(kinds(run({ gateways: [z2m] }))).toEqual(['gateway_offline']);
    });

    it('treats an unknown status like one that is not online', () => {
      const unknown = gateway({ z2mStatus: 'unknown', statusChangedAt: ago(10 * MINUTE) });
      expect(kinds(run({ gateways: [unknown] }))).toEqual(['gateway_offline']);
    });

    it('stays quiet for a gateway nothing was ever heard from', () => {
      const silent = gateway({
        bridgeStatus: 'unknown',
        z2mStatus: 'unknown',
        statusChangedAt: null,
        lastMessageAt: null,
      });
      expect(run({ gateways: [silent] })).toEqual([]);
    });

    it('is the only item for an offline gateway with 12 devices', () => {
      const devices = Array.from({ length: 12 }, (_, index) =>
        device({
          id: `dev-${index}`,
          availability: 'offline',
          lastSeenAt: ago(5 * HOUR),
          state: { soil_moisture: 5, battery: 3, dry: true },
        }),
      );
      const items = run({ gateways: [offlineSince(30)], devices });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: 'gateway_offline',
        params: { affectedDevices: 12 },
      });
    });

    it('suppresses only the devices of that gateway', () => {
      const items = run({
        gateways: [offlineSince(30), gateway({ id: 'gw-bbbbbbbb', name: 'Garage' })],
        devices: [
          device({ id: 'behind', availability: 'offline' }),
          device({ id: 'elsewhere', gatewayId: 'gw-bbbbbbbb', availability: 'offline' }),
        ],
      });
      expect(items.map((item) => item.id).sort()).toEqual([
        'device_silent:elsewhere',
        'gateway_offline:gw-aaaaaaaa',
      ]);
    });

    it('lets the devices speak again once the gateway is back', () => {
      const devices = [device({ availability: 'offline' })];
      expect(kinds(run({ gateways: [gateway()], devices }))).toEqual(['device_silent']);
    });
  });

  describe('hardware_new', () => {
    it('lists unassigned hardware by its first sighting', () => {
      const [item] = run({
        hardware: [
          { id: 'hw-1', gatewayId: 'gw-aaaaaaaa', name: 'Sensor', firstSeenAt: ago(HOUR) },
        ],
      });
      expect(item).toMatchObject({
        id: 'hardware_new:hw-1',
        kind: 'hardware_new',
        severity: 'info',
        name: 'Sensor',
        gatewayId: 'gw-aaaaaaaa',
        since: ago(HOUR).toISOString(),
      });
    });
  });

  describe('cert_expiring', () => {
    it('follows the warnings of the gateway', () => {
      const expiresAt = new Date(NOW.getTime() + 10 * 86_400_000);
      const [item] = run({
        gateways: [gateway({ certExpiresAt: expiresAt, warnings: ['certExpiring'] })],
      });
      expect(item).toMatchObject({
        id: 'cert_expiring:gw-aaaaaaaa',
        severity: 'info',
        params: { subject: 'certificate', expired: false, expiresAt: expiresAt.toISOString() },
      });
      expect(run({ gateways: [gateway()] })).toEqual([]);
    });

    it('marks an expired certificate', () => {
      const [item] = run({
        gateways: [gateway({ certExpiresAt: ago(HOUR), warnings: ['certExpired'] })],
      });
      expect(item?.params).toMatchObject({ expired: true });
    });

    it('adds one item for the CRL, however many gateways there are', () => {
      const crlNextUpdate = new Date(NOW.getTime() + 5 * 86_400_000);
      const warned = (id: string) => gateway({ id, warnings: ['crlExpiring'] });
      const items = run({
        gateways: [warned('gw-aaaaaaaa'), warned('gw-bbbbbbbb')],
        crlNextUpdate,
      });
      expect(items.map((item) => item.id)).toEqual(['cert_expiring:crl']);
      expect(items[0]?.params).toMatchObject({ subject: 'crl', expired: false });
    });
  });

  describe('since', () => {
    it('stays while the item exists', () => {
      const dry = withState({ soil_moisture: 10 }, { lastSeenAt: ago(HOUR) });
      const first = run({ devices: [dry] });
      expect(first[0]?.since).toBe(ago(HOUR).toISOString());
      const later = new Date(NOW.getTime() + 10 * MINUTE);
      const reported = withState({ soil_moisture: 9 }, { lastSeenAt: later });
      const second = evaluate(snapshot({ devices: [reported] }), { items: first }, later);
      expect(second[0]?.since).toBe(first[0]?.since);
      expect(second[0]?.value).toBe(9);
    });

    it('starts anew after the item ended', () => {
      const dry = withState({ soil_moisture: 10 }, { lastSeenAt: ago(HOUR) });
      const first = run({ devices: [dry] });
      const ok = run({ devices: [withState({ soil_moisture: 60 })] }, { items: first });
      expect(ok).toEqual([]);
      const later = new Date(NOW.getTime() + HOUR);
      const again = evaluate(
        snapshot({ devices: [withState({ soil_moisture: 10 }, { lastSeenAt: later })] }),
        { items: ok },
        later,
      );
      expect(again[0]?.since).toBe(later.toISOString());
    });

    it('is never in the future', () => {
      const future = withState(
        { soil_moisture: 10 },
        { lastSeenAt: new Date(NOW.getTime() + HOUR) },
      );
      expect(run({ devices: [future] })[0]?.since).toBe(NOW.toISOString());
    });
  });

  describe('ids and order', () => {
    it('uses a stable id per kind and subject', () => {
      const items = run({
        devices: [withState({ soil_moisture: 10, battery: 5 })],
      });
      expect(items.map((item) => item.id).sort()).toEqual(['battery_low:dev-1', 'soil_dry:dev-1']);
    });

    it('sorts by urgency, then newest first', () => {
      const items = run({
        gateways: [gateway({ id: 'gw-aaaaaaaa' }), gateway({ id: 'gw-bbbbbbbb', name: 'Other' })],
        devices: [
          withState({ soil_moisture: 10 }, { id: 'old', lastSeenAt: ago(HOUR) }),
          withState({ soil_moisture: 10 }, { id: 'new', lastSeenAt: ago(MINUTE) }),
          device({ id: 'gone', availability: 'offline', gatewayId: 'gw-bbbbbbbb' }),
        ],
        hardware: [{ id: 'hw', gatewayId: 'gw-aaaaaaaa', name: 'x', firstSeenAt: ago(HOUR) }],
      });
      expect(items.map((item) => item.id)).toEqual([
        'device_silent:gone',
        'soil_dry:new',
        'soil_dry:old',
        'hardware_new:hw',
      ]);
    });

    it('does not carry roomId in 6b', () => {
      const items = run({ devices: [withState({ soil_moisture: 10 })] });
      expect(items.every((item) => item.roomId === undefined)).toBe(true);
    });
  });
});
