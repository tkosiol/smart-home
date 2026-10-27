import type { HouseholdRole } from '@smart/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveHub, type Audience, type LiveClient } from './live-hub.js';
import { SSE_PING, sseEvent } from './sse.js';

interface FakeClient extends LiveClient {
  writes: string[];
  closed: number;
  full: boolean;
  throwOnWrite: boolean;
}

const fake = (
  role: HouseholdRole,
  over: Partial<Pick<LiveClient, 'householdId' | 'userId' | 'sessionId'>> & {
    isPlatformAdmin?: boolean;
  } = {},
): FakeClient => {
  const client: FakeClient = {
    householdId: over.householdId ?? 'h1',
    userId: over.userId ?? `u-${role}`,
    sessionId: over.sessionId ?? `s-${role}`,
    audience: { role, isPlatformAdmin: over.isPlatformAdmin ?? false },
    writes: [],
    closed: 0,
    full: false,
    throwOnWrite: false,
    write(chunk) {
      if (client.throwOnWrite) throw new Error('destroyed');
      client.writes.push(chunk);
      return !client.full;
    },
    close() {
      client.closed += 1;
    },
  };
  return client;
};

describe('LiveHub', () => {
  let active: Map<string, boolean>;
  let roles: Map<string, HouseholdRole>;
  let admins: Set<string>;
  let failing: boolean;
  let hub: LiveHub;

  beforeEach(() => {
    active = new Map();
    roles = new Map();
    admins = new Set();
    failing = false;
    const sessions = {
      isActive: (id: string) => {
        if (failing) return Promise.reject(new Error('db down'));
        return Promise.resolve(active.get(id) ?? true);
      },
    };
    const memberships = {
      find: (householdId: string, userId: string) => {
        const role = roles.get(`${householdId}:${userId}`);
        return Promise.resolve(role ? { role } : undefined);
      },
    };
    const users = {
      findById: (id: string) => Promise.resolve({ id, isPlatformAdmin: admins.has(id) }),
    };
    hub = new LiveHub(sessions as never, memberships as never, users as never, {
      heartbeatMs: 25_000,
      throttleMs: 1000,
    });
  });

  afterEach(() => {
    hub.onModuleDestroy();
    vi.useRealTimers();
  });

  const member = (client: FakeClient, role: HouseholdRole = client.audience.role): void => {
    roles.set(`${client.householdId}:${client.userId}`, role);
  };

  it('distributes by minimum role', () => {
    const viewer = fake('viewer');
    const mem = fake('member');
    const owner = fake('owner');
    for (const c of [viewer, mem, owner]) hub.add(c);
    hub.publish('h1', 'gateway.status', { a: 1 }, 'owner');
    expect(viewer.writes).toEqual([]);
    expect(mem.writes).toEqual([]);
    expect(owner.writes).toEqual([sseEvent('gateway.status', { a: 1 })]);
    hub.publish('h1', 'device.state', { b: 2 }, 'member');
    expect(viewer.writes).toEqual([]);
    expect(mem.writes).toHaveLength(1);
    hub.publish('h1', 'device.state', { c: 3 }, 'viewer');
    expect(viewer.writes).toHaveLength(1);
  });

  it('gives another household nothing and ignores unknown households', () => {
    const other = fake('owner', { householdId: 'h2' });
    hub.add(other);
    hub.publish('h1', 'device.state', {}, 'viewer');
    hub.publish('nope', 'device.state', {}, 'viewer');
    hub.publishByAudience('nope', 'attention.changed', () => 1);
    expect(other.writes).toEqual([]);
  });

  it('builds once per distinct audience and filters by it', () => {
    const v1 = fake('viewer', { userId: 'a', sessionId: 'sa' });
    const v2 = fake('viewer', { userId: 'b', sessionId: 'sb' });
    const owner = fake('owner');
    const admin = fake('viewer', { userId: 'c', sessionId: 'sc', isPlatformAdmin: true });
    for (const c of [v1, v2, owner, admin]) hub.add(c);
    const build = vi.fn((a: Audience) =>
      a.role === 'owner' || a.isPlatformAdmin ? ['cert_expiring', 'x'] : ['x'],
    );
    hub.publishByAudience('h1', 'attention.changed', build);
    expect(build).toHaveBeenCalledTimes(3);
    expect(v1.writes).toEqual([sseEvent('attention.changed', ['x'])]);
    expect(v2.writes).toEqual(v1.writes);
    expect(owner.writes[0]).toContain('cert_expiring');
    expect(admin.writes[0]).toContain('cert_expiring');
  });

  it('skips only the audience whose build throws', () => {
    const viewer = fake('viewer');
    const owner = fake('owner');
    hub.add(viewer);
    hub.add(owner);
    hub.publishByAudience('h1', 'attention.changed', (a) => {
      if (a.role === 'viewer') throw new Error('boom');
      return 1;
    });
    expect(viewer.writes).toEqual([]);
    expect(owner.writes).toHaveLength(1);
  });

  it('closes a client that connects after shutdown and does not register it', () => {
    hub.onModuleDestroy();
    const c = fake('owner');
    const remove = hub.add(c);
    expect(c.closed).toBe(1);
    expect(hub.watching('h1')).toBe(false);
    remove();
    expect(c.closed).toBe(1);
  });

  it('closes and removes a client whose buffer is full', () => {
    const c = fake('owner');
    c.full = true;
    hub.add(c);
    hub.publish('h1', 'device.state', {}, 'viewer');
    expect(c.closed).toBe(1);
    expect(hub.watching('h1')).toBe(false);
    hub.publish('h1', 'device.state', {}, 'viewer');
    expect(c.writes).toHaveLength(1);
  });

  it('treats a throwing write like a full buffer', () => {
    const c = fake('owner');
    c.throwOnWrite = true;
    hub.add(c);
    hub.publish('h1', 'device.state', {}, 'viewer');
    expect(c.closed).toBe(1);
    expect(hub.watching('h1')).toBe(false);
  });

  it('removes on unsubscribe, twice harmlessly', () => {
    const c = fake('owner');
    const off = hub.add(c);
    expect(hub.watching('h1')).toBe(true);
    off();
    off();
    expect(hub.watching('h1')).toBe(false);
    hub.publish('h1', 'device.state', {}, 'viewer');
    expect(c.writes).toEqual([]);
    expect(c.closed).toBe(0);
  });

  it('pings on heartbeat and keeps valid clients', async () => {
    const c = fake('member');
    member(c);
    hub.add(c);
    await hub.heartbeat();
    expect(c.writes).toEqual([SSE_PING]);
    expect(c.closed).toBe(0);
  });

  it('closes a client with an inactive session', async () => {
    const c = fake('member');
    member(c);
    hub.add(c);
    active.set(c.sessionId, false);
    await hub.heartbeat();
    expect(c.closed).toBe(1);
    expect(hub.watching('h1')).toBe(false);
  });

  it('closes a client whose membership is gone', async () => {
    const c = fake('member');
    hub.add(c);
    await hub.heartbeat();
    expect(c.closed).toBe(1);
  });

  it('adopts a changed role and admin flag', async () => {
    const c = fake('owner');
    member(c, 'viewer');
    admins.add(c.userId);
    hub.add(c);
    await hub.heartbeat();
    expect(c.audience).toEqual({ role: 'viewer', isPlatformAdmin: true });
    hub.publish('h1', 'gateway.status', {}, 'owner');
    expect(c.writes).toEqual([SSE_PING]);
  });

  it('does not close when the check fails', async () => {
    const c = fake('member');
    member(c);
    hub.add(c);
    failing = true;
    await hub.heartbeat();
    expect(c.closed).toBe(0);
    expect(hub.watching('h1')).toBe(true);
  });

  it('closes a client whose ping write fails', async () => {
    const c = fake('member');
    member(c);
    c.full = true;
    hub.add(c);
    await hub.heartbeat();
    expect(c.closed).toBe(1);
  });

  it('does not overlap heartbeats', async () => {
    const c = fake('member');
    member(c);
    hub.add(c);
    const first = hub.heartbeat();
    await hub.heartbeat();
    await first;
    expect(c.writes).toEqual([SSE_PING]);
  });

  it('runs the heartbeat on a timer and stops it on destroy', async () => {
    vi.useFakeTimers();
    const c = fake('member');
    member(c);
    hub.onModuleInit();
    hub.add(c);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(c.writes).toEqual([SSE_PING]);
    hub.onModuleDestroy();
    expect(c.closed).toBe(1);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(c.writes).toEqual([SSE_PING]);
    expect(hub.watching('h1')).toBe(false);
  });

  it('closes all clients on destroy', () => {
    const a = fake('owner');
    const b = fake('viewer', { householdId: 'h2' });
    hub.add(a);
    hub.add(b);
    hub.onModuleDestroy();
    expect([a.closed, b.closed]).toEqual([1, 1]);
  });
});
