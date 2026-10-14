import { describe, expect, it } from 'vitest';
import { isBridgeTopic, isCommandTopic, isDeviceTraffic } from './z2m-topics.js';

describe('z2m topics (the part below the gateway prefix)', () => {
  it.each(['Pflanze 1/set', 'Lampe/set/brightness', 'Lampe/get', 'a/b/get/state'])(
    '%s is a command',
    (rest) => {
      expect(isCommandTopic(rest)).toBe(true);
      expect(isDeviceTraffic(rest)).toBe(false);
    },
  );

  it.each([
    'bridge/devices',
    'bridge/event',
    'bridge/state',
    'bridge/request/permit_join',
    'bridge/response/x',
    'bridge/logging',
  ])('%s belongs to the bridge', (rest) => {
    expect(isBridgeTopic(rest)).toBe(true);
    expect(isDeviceTraffic(rest)).toBe(false);
  });

  it.each(['Pflanze 1', 'Pflanze 1/availability', 'Garten/Beet 2', 'bridgehead', 'settings'])(
    '%s is device traffic',
    (rest) => {
      expect(isCommandTopic(rest)).toBe(false);
      expect(isBridgeTopic(rest)).toBe(false);
      expect(isDeviceTraffic(rest)).toBe(true);
    },
  );
});
