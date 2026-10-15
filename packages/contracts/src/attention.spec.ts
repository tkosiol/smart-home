import { describe, expect, it } from 'vitest';
import {
  ATTENTION_KINDS,
  SEVERITY_OF,
  attentionItemSchema,
  attentionListSchema,
} from './attention.js';

describe('SEVERITY_OF', () => {
  it('rates every kind', () => {
    expect(Object.keys(SEVERITY_OF).sort()).toEqual([...ATTENTION_KINDS].sort());
    expect(SEVERITY_OF).toEqual({
      gateway_offline: 'critical',
      device_silent: 'critical',
      soil_dry: 'warning',
      soil_wet: 'warning',
      battery_low: 'warning',
      contact_open: 'info',
      hardware_new: 'info',
      cert_expiring: 'info',
    });
  });
});

describe('attentionItemSchema', () => {
  const item = {
    id: 'soil_dry:d1',
    kind: 'soil_dry',
    severity: 'warning',
    since: '2026-10-15T08:00:00.000Z',
    deviceId: 'd1',
    name: 'Ficus',
    value: 18,
    unit: '%',
    params: { min: 25 },
  };

  it('accepts an item and a list', () => {
    expect(attentionItemSchema.safeParse(item).success).toBe(true);
    expect(attentionListSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(attentionListSchema.safeParse({ items: [] }).success).toBe(true);
  });

  it('rejects an unknown kind and a bad timestamp', () => {
    expect(attentionItemSchema.safeParse({ ...item, kind: 'nope' }).success).toBe(false);
    expect(attentionItemSchema.safeParse({ ...item, since: 'yesterday' }).success).toBe(false);
  });
});
