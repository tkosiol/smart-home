import { describe, expect, it } from 'vitest';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from './appearance.js';
import { DEFAULT_RUNTIME_CONFIG, parseRuntimeConfig } from './runtime-config.js';

const plum: InstanceAppearance = {
  ...DEFAULT_INSTANCE_APPEARANCE,
  colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
};

describe('parseRuntimeConfig', () => {
  it('reads features and the instance appearance', () => {
    expect(
      parseRuntimeConfig({
        features: { instanceAppearanceEditor: true },
        instanceAppearance: plum,
      }),
    ).toEqual({ features: { instanceAppearanceEditor: true }, instanceAppearance: plum });
  });

  it('leaves the instance appearance out when none is set', () => {
    expect(parseRuntimeConfig({ features: { instanceAppearanceEditor: false } })).toEqual({
      features: { instanceAppearanceEditor: false },
    });
  });

  it('keeps the features when only the instance appearance is invalid', () => {
    expect(
      parseRuntimeConfig({
        features: { instanceAppearanceEditor: true },
        instanceAppearance: { colors: { seed: 'petrol' } },
      }),
    ).toEqual({ features: { instanceAppearanceEditor: true } });
  });

  it('keeps the instance appearance when only the features are invalid', () => {
    expect(
      parseRuntimeConfig({
        features: { instanceAppearanceEditor: 'true' },
        instanceAppearance: plum,
      }),
    ).toEqual({ ...DEFAULT_RUNTIME_CONFIG, instanceAppearance: plum });
  });

  it.each([null, 42, 'config', []])('falls back to the defaults for %j', (raw) => {
    expect(parseRuntimeConfig(raw)).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('keeps the instance appearance editor off by default', () => {
    expect(DEFAULT_RUNTIME_CONFIG.features.instanceAppearanceEditor).toBe(false);
  });
});
