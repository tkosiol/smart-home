import { describe, expect, it } from 'vitest';
import {
  CANONICAL_KEYS,
  CAPABILITY_KEY_PATTERN,
  CAPABILITY_VOCABULARY,
  isCanonicalKey,
  vocabularyEntry,
} from './vocabulary.js';

describe('capability vocabulary', () => {
  it('keeps the keys that are stored today', () => {
    expect(CANONICAL_KEYS).toEqual([
      'temperature',
      'humidity',
      'soil_moisture',
      'battery',
      'linkquality',
      'contact',
      'state',
      'brightness',
      'color_temp',
    ]);
  });

  it('fixes units and ranges', () => {
    expect(vocabularyEntry('temperature')).toMatchObject({
      kind: 'numeric',
      unit: '°C',
      min: null,
      max: null,
      role: 'reading',
    });
    expect(vocabularyEntry('soil_moisture')).toMatchObject({ unit: '%', min: 0, max: 100 });
    expect(vocabularyEntry('linkquality')).toMatchObject({ unit: 'lqi', min: 0, max: 255 });
    expect(vocabularyEntry('state')).toMatchObject({ kind: 'binary', unit: null, role: 'control' });
    expect(vocabularyEntry('brightness')).toMatchObject({
      kind: 'numeric',
      unit: '%',
      min: 0,
      max: 100,
      role: 'control',
    });
    expect(vocabularyEntry('color_temp')).toMatchObject({
      kind: 'numeric',
      unit: 'K',
      min: 1000,
      max: 10000,
      role: 'control',
    });
    expect(vocabularyEntry('contact')).toMatchObject({ kind: 'binary', role: 'reading' });
  });

  it('tells canonical keys apart', () => {
    expect(isCanonicalKey('brightness')).toBe(true);
    expect(isCanonicalKey('dry')).toBe(false);
    expect(isCanonicalKey('toString')).toBe(false);
  });

  it('only has keys that fit the key pattern', () => {
    for (const entry of CAPABILITY_VOCABULARY) expect(entry.key).toMatch(CAPABILITY_KEY_PATTERN);
    expect('state_z2m').toMatch(CAPABILITY_KEY_PATTERN);
    expect('State').not.toMatch(CAPABILITY_KEY_PATTERN);
    expect('a'.repeat(65)).not.toMatch(CAPABILITY_KEY_PATTERN);
  });
});
