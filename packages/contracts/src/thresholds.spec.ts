import { describe, expect, it } from 'vitest';
import { LOW_BATTERY_PERCENT } from './devices.js';
import {
  DEFAULT_THRESHOLDS,
  GATEWAY_OFFLINE_MINUTES,
  effectiveThresholds,
  thresholdsSchema,
} from './thresholds.js';

describe('DEFAULT_THRESHOLDS', () => {
  it('gives soil a minimum and everything else none', () => {
    expect(DEFAULT_THRESHOLDS.soil).toEqual({
      soilMoistureMin: 25,
      soilMoistureMax: null,
      batteryMin: LOW_BATTERY_PERCENT,
      contactOpenMinutes: 10,
      silentMinutes: 120,
    });
    for (const kind of ['light', 'climate', 'contact', 'other'] as const) {
      expect(DEFAULT_THRESHOLDS[kind]).toEqual({
        soilMoistureMin: null,
        soilMoistureMax: null,
        batteryMin: 20,
        contactOpenMinutes: 10,
        silentMinutes: 120,
      });
    }
    expect(GATEWAY_OFFLINE_MINUTES).toBe(5);
  });
});

describe('effectiveThresholds', () => {
  it('uses the kind defaults for null, undefined and empty', () => {
    expect(effectiveThresholds('soil', null)).toEqual(DEFAULT_THRESHOLDS.soil);
    expect(effectiveThresholds('soil', undefined)).toEqual(DEFAULT_THRESHOLDS.soil);
    expect(effectiveThresholds('soil', {})).toEqual(DEFAULT_THRESHOLDS.soil);
  });

  it('treats null fields as "use the default"', () => {
    const own = { soilMoistureMin: null, batteryMin: null, silentMinutes: null };
    expect(effectiveThresholds('soil', own)).toEqual(DEFAULT_THRESHOLDS.soil);
  });

  it('prefers set values, including 0', () => {
    expect(
      effectiveThresholds('soil', { soilMoistureMin: 0, soilMoistureMax: 80, batteryMin: 5 }),
    ).toEqual({
      soilMoistureMin: 0,
      soilMoistureMax: 80,
      batteryMin: 5,
      contactOpenMinutes: 10,
      silentMinutes: 120,
    });
    expect(effectiveThresholds('contact', { contactOpenMinutes: 30 }).contactOpenMinutes).toBe(30);
  });

  it('does not mutate the defaults', () => {
    const result = effectiveThresholds('light', null);
    result.batteryMin = 1;
    expect(DEFAULT_THRESHOLDS.light.batteryMin).toBe(20);
  });
});

describe('thresholdsSchema', () => {
  it('accepts empty, null and valid values', () => {
    expect(thresholdsSchema.safeParse({}).success).toBe(true);
    expect(
      thresholdsSchema.safeParse({ soilMoistureMin: null, soilMoistureMax: null }).success,
    ).toBe(true);
    expect(
      thresholdsSchema.safeParse({
        soilMoistureMin: 0,
        soilMoistureMax: 100,
        batteryMin: 0,
        contactOpenMinutes: 1,
        silentMinutes: 10080,
      }).success,
    ).toBe(true);
    expect(thresholdsSchema.safeParse({ soilMoistureMin: 30 }).success).toBe(true);
  });

  it('rejects min >= max when both are numbers', () => {
    expect(thresholdsSchema.safeParse({ soilMoistureMin: 50, soilMoistureMax: 50 }).success).toBe(
      false,
    );
    expect(thresholdsSchema.safeParse({ soilMoistureMin: 60, soilMoistureMax: 40 }).success).toBe(
      false,
    );
    expect(thresholdsSchema.safeParse({ soilMoistureMin: 40, soilMoistureMax: 60 }).success).toBe(
      true,
    );
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(thresholdsSchema.safeParse({ soilMoistureMax: 101 }).success).toBe(false);
    expect(thresholdsSchema.safeParse({ soilMoistureMin: -1 }).success).toBe(false);
    expect(thresholdsSchema.safeParse({ batteryMin: 101 }).success).toBe(false);
    expect(thresholdsSchema.safeParse({ contactOpenMinutes: 0 }).success).toBe(false);
    expect(thresholdsSchema.safeParse({ silentMinutes: 10081 }).success).toBe(false);
    expect(thresholdsSchema.safeParse({ silentMinutes: 1.5 }).success).toBe(false);
  });
});
