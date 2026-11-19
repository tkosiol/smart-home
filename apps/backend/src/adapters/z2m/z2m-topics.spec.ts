import { describe, expect, it } from 'vitest';
import { isBridgeTopic, isCommandTopic } from './z2m-topics.js';

describe('z2m topics (the part below the gateway prefix)', () => {
  it.each(['Pflanze 1/set', 'Lampe/set/brightness', 'Lampe/get', 'a/b/get/state'])(
    '%s is a command',
    (rest) => {
      expect(isCommandTopic(rest)).toBe(true);
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
  });

  it.each(['Pflanze 1', 'Pflanze 1/availability', 'Garten/Beet 2', 'bridgehead', 'settings'])(
    '%s is neither command nor bridge',
    (rest) => {
      expect(isCommandTopic(rest)).toBe(false);
      expect(isBridgeTopic(rest)).toBe(false);
    },
  );
});
