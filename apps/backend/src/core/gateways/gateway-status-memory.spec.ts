import { describe, expect, it } from 'vitest';
import { StatusMemory } from './gateway-status-memory.js';

const at = (seconds: number): Date => new Date(1_000_000 + seconds * 1000);

describe('StatusMemory', () => {
  it('remembers the last status of each kind and when it last changed', () => {
    const memory = new StatusMemory(10);
    expect(memory.recall('gw-00000001')).toBeUndefined();
    memory.record('gw-00000001', 'bridge', 'online', at(1));
    memory.record('gw-00000001', 'z2m', 'offline', at(2));
    memory.record('gw-00000001', 'z2m', 'offline', at(3));
    expect(memory.recall('gw-00000001')).toEqual({
      bridge: 'online',
      z2m: 'offline',
      at: at(2),
    });
  });

  it('reports whether the status changed', () => {
    const memory = new StatusMemory(10);
    expect(memory.record('gw-00000001', 'bridge', 'online', at(1))).toBe(true);
    expect(memory.record('gw-00000001', 'bridge', 'online', at(2))).toBe(false);
    expect(memory.record('gw-00000001', 'bridge', 'offline', at(3))).toBe(true);
  });

  it('keeps at most the given number of IDs and drops the longest silent first', () => {
    const memory = new StatusMemory(3);
    for (const [index, id] of ['gw-00000001', 'gw-00000002', 'gw-00000003'].entries()) {
      memory.record(id, 'bridge', 'online', at(index));
    }
    memory.record('gw-00000001', 'bridge', 'online', at(10));
    memory.record('gw-00000004', 'bridge', 'online', at(11));
    expect(memory.recall('gw-00000002')).toBeUndefined();
    expect(memory.recall('gw-00000001')).toBeDefined();
    expect(memory.recall('gw-00000003')).toBeDefined();
    expect(memory.recall('gw-00000004')).toBeDefined();
  });

  it('returns copies, so callers cannot change the memory', () => {
    const memory = new StatusMemory(3);
    memory.record('gw-00000001', 'bridge', 'online', at(1));
    const recalled = memory.recall('gw-00000001');
    if (recalled) recalled.bridge = 'offline';
    expect(memory.recall('gw-00000001')?.bridge).toBe('online');
  });
});
