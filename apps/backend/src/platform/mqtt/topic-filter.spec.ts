import { describe, expect, it } from 'vitest';
import { matchesFilter } from './topic-filter.js';

describe('matchesFilter', () => {
  it.each([
    ['a/b', 'a/b', true],
    ['a/b', 'a/c', false],
    ['a/+/c', 'a/b/c', true],
    ['a/+/c', 'a/b/d', false],
    ['a/+/c', 'a/b/c/d', false],
    ['a/+', 'a', false],
    ['a/#', 'a/b/c', true],
    ['a/#', 'a', true],
    ['a/#', 'b/c', false],
    ['#', 'a/b', true],
    ['gw/+/z2m/#', 'gw/gw-a1b2c3d4/z2m/bridge/state', true],
    ['gw/+/z2m/#', 'gw/gw-a1b2c3d4/bridge/connection', false],
    ['a/b/c', 'a/b', false],
  ])('%s against %s is %s', (filter, topic, expected) => {
    expect(matchesFilter(filter, topic)).toBe(expected);
  });
});
