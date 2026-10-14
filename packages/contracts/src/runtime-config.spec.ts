import { describe, expect, it } from 'vitest';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from './appearance.js';
import { DEFAULT_RUNTIME_CONFIG, parseRuntimeConfig } from './runtime-config.js';

const plum: InstanceAppearance = {
  ...DEFAULT_INSTANCE_APPEARANCE,
  colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
};

describe('parseRuntimeConfig', () => {
  it('reads the instance appearance', () => {
    expect(parseRuntimeConfig({ instanceAppearance: plum })).toEqual({ instanceAppearance: plum });
  });

  it('leaves the instance appearance out when none is set', () => {
    expect(parseRuntimeConfig({})).toEqual({});
  });

  it('ignores the features of older configs', () => {
    expect(
      parseRuntimeConfig({
        features: { instanceAppearanceEditor: true },
        instanceAppearance: plum,
      }),
    ).toEqual({ instanceAppearance: plum });
    expect(parseRuntimeConfig({ features: { instanceAppearanceEditor: true } })).toEqual({});
  });

  it('falls back to the defaults when the instance appearance is invalid', () => {
    expect(parseRuntimeConfig({ instanceAppearance: { colors: { seed: 'petrol' } } })).toEqual(
      DEFAULT_RUNTIME_CONFIG,
    );
  });

  it.each([null, 42, 'config', []])('falls back to the defaults for %j', (raw) => {
    expect(parseRuntimeConfig(raw)).toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});
