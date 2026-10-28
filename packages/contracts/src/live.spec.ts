import { describe, expect, it } from 'vitest';
import { LIVE_EVENT_TYPES, liveEventSchema } from './live.js';

const device = {
  id: '0b8f1c2d-3e4f-4a5b-9c6d-7e8f9a0b1c2d',
  name: 'Basilikum',
  icon: null,
  hardware: { id: 'h1', vendor: 'IKEA', model: 'LED1624G9', description: null },
  availability: 'online' as const,
  lastSeenAt: '2026-10-14T08:00:00.000Z',
  state: { state: 'ON' },
  capabilities: [],
  kind: 'light' as const,
  thresholds: {},
  effectiveThresholds: {
    soilMoistureMin: null,
    soilMoistureMax: null,
    batteryMin: 20,
    contactOpenMinutes: 10,
    silentMinutes: 120,
  },
};

const hardware = {
  id: '7d6e8f0a-1b2c-4d3e-8f4a-5b6c7d8e9f01',
  gatewayId: 'gw-sim00001',
  ieeeAddress: '0x00000000000000a1',
  friendlyName: 'Pflanze 1',
  vendor: 'AOYAN',
  model: 'AY-303Z',
  description: null,
  availability: 'online' as const,
  lastSeenAt: '2026-10-14T08:00:00.000Z',
  lastState: { soil_moisture: 41 },
  capabilities: [],
};

const gateway = {
  id: 'gw-a1b2c3d4',
  name: 'Keller',
  kind: 'z2m' as const,
  topicPrefix: 'zigbee2mqtt',
  bridgeStatus: 'online' as const,
  z2mStatus: 'unknown' as const,
  statusChangedAt: '2026-10-14T08:00:00.000Z',
  lastMessageAt: null,
  certExpiresAt: '2027-10-14T08:00:00.000Z',
  revokedAt: null,
  warnings: [],
};

const attention = { items: [] };

const valid = {
  'device.state': device,
  'gateway.status': gateway,
  'hardware.updated': hardware,
  'hardware.removed': { id: hardware.id },
  'attention.changed': attention,
};

describe('liveEventSchema', () => {
  it('lists every event type once', () => {
    expect([...LIVE_EVENT_TYPES].sort()).toEqual(Object.keys(valid).sort());
  });

  it.each(LIVE_EVENT_TYPES)('accepts %s with its data', (type) => {
    expect(liveEventSchema.safeParse({ type, data: valid[type] }).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(liveEventSchema.safeParse({ type: 'device.deleted', data: device }).success).toBe(false);
  });

  it('rejects device.state with hardware data', () => {
    expect(liveEventSchema.safeParse({ type: 'device.state', data: hardware }).success).toBe(false);
  });

  it('rejects hardware.removed without an id', () => {
    expect(liveEventSchema.safeParse({ type: 'hardware.removed', data: {} }).success).toBe(false);
  });
});
