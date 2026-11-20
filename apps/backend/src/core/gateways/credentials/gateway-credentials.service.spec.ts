import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../platform/config/index.js';
import type { MqttConnection, MqttMessageHandler } from '../../../platform/mqtt/index.js';
import type { GatewaysRepository } from '../gateways.repository.js';
import { GatewayCredentials } from './gateway-credentials.service.js';
import { deriveGatewayPassword } from './password.js';

const SECRET = 's'.repeat(32);
const RESPONSE_TOPIC = '$CONTROL/dynamic-security/v1/response';
const MINUTE_MS = 60_000;

type Command = Record<string, unknown> & { command: string };
/** What the broker answers: fields of the response, or `silent` for no answer at all. */
type Answer = { error?: string; data?: unknown } | 'silent';

/** A broker behind the platform connection that answers every command as the test says. */
class ScriptedBroker {
  readonly commands: Command[] = [];
  connected = true;
  private handler: MqttMessageHandler | undefined;
  private readonly listeners = new Set<() => void>();
  answer: (command: Command) => Answer = () => ({});

  subscribe(_filter: string, handler: MqttMessageHandler) {
    this.handler = handler;
    return () => undefined;
  }

  publish(_topic: string, payload: string | Buffer): Promise<void> {
    const document = JSON.parse(payload.toString()) as { commands: Command[] };
    const command = document.commands[0];
    if (!command) throw new Error('no command');
    this.commands.push(command);
    const answer = this.answer(command);
    if (answer !== 'silent') {
      const response = { command: command.command, correlationData: command.correlationData };
      queueMicrotask(() => {
        void this.handler?.(
          RESPONSE_TOPIC,
          Buffer.from(JSON.stringify({ responses: [{ ...response, ...answer }] })),
          false,
        );
      });
    }
    return Promise.resolve();
  }

  onConnect(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** The backend (re)connected. */
  connect(): void {
    for (const listener of this.listeners) listener();
  }

  names(): string[] {
    return this.commands.map((command) => command.command);
  }

  /** The commands without the correlation data, which differs on every run. */
  sent(): Record<string, unknown>[] {
    return this.commands.map((command) => {
      const rest: Record<string, unknown> = { ...command };
      delete rest.correlationData;
      return rest;
    });
  }
}

/** Lets everything that is queued run (real timers only). */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('GatewayCredentials', () => {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  let broker: ScriptedBroker;
  let wanted: { id: string; generation: number }[];
  let listActiveCredentials: () => Promise<{ id: string; generation: number }[]>;
  let now: Date;

  const make = (env: Partial<Env> = { GATEWAY_CREDENTIAL_SECRET: SECRET }): GatewayCredentials =>
    new GatewayCredentials(
      { listActiveCredentials: () => listActiveCredentials() } as unknown as GatewaysRepository,
      broker as unknown as MqttConnection,
      env as Env,
      () => now,
    );
  const logged = (): string =>
    [...warn.mock.calls, ...error.mock.calls].map((call) => call.map(String).join(' ')).join('\n');

  beforeEach(() => {
    broker = new ScriptedBroker();
    wanted = [];
    listActiveCredentials = () => Promise.resolve(wanted);
    now = new Date('2026-11-20T10:00:00Z');
  });

  afterEach(() => {
    warn.mockClear();
    error.mockClear();
    vi.useRealTimers();
  });

  describe('without a secret', () => {
    it('is disabled, does nothing and warns at most once an hour', async () => {
      const credentials = make({});
      expect(credentials.enabled).toBe(false);
      await credentials.reconcile();
      await credentials.reconcile();
      expect(broker.commands).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(logged()).toContain('GATEWAY_CREDENTIAL_SECRET');
      now = new Date(now.getTime() + 59 * MINUTE_MS);
      await credentials.reconcile();
      expect(warn).toHaveBeenCalledTimes(1);
      now = new Date(now.getTime() + MINUTE_MS);
      await credentials.reconcile();
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('cannot derive keys', () => {
      expect(() => make({}).password('gw-00000001', 1)).toThrow();
    });
  });

  it('derives the key of a gateway from the secret', () => {
    const credentials = make();
    expect(credentials.enabled).toBe(true);
    expect(credentials.password('gw-00000001', 2)).toBe(
      deriveGatewayPassword(SECRET, 'gw-00000001', 2),
    );
  });

  it('creates a user with client ID, generation and role', async () => {
    await make().create('gw-00000001', 1);
    expect(broker.sent()).toEqual([
      {
        command: 'createClient',
        username: 'gw-00000001',
        password: deriveGatewayPassword(SECRET, 'gw-00000001', 1),
        clientid: 'gw-00000001-ha',
        textdescription: 'generation:1',
        roles: [{ rolename: 'smart-gateway-ha' }],
      },
    ]);
  });

  it('rekeys a user: new password, then the new generation', async () => {
    await make().rekey('gw-00000001', 3);
    expect(broker.sent()).toEqual([
      {
        command: 'setClientPassword',
        username: 'gw-00000001',
        password: deriveGatewayPassword(SECRET, 'gw-00000001', 3),
      },
      { command: 'modifyClient', username: 'gw-00000001', textdescription: 'generation:3' },
    ]);
  });

  it('removes a user and counts a missing one as removed', async () => {
    const credentials = make();
    broker.answer = () => ({ error: 'Client not found' });
    await expect(credentials.remove('gw-00000001')).resolves.toBeUndefined();
    expect(broker.sent()).toEqual([{ command: 'deleteClient', username: 'gw-00000001' }]);
    broker.answer = () => ({ error: 'Something else' });
    await expect(credentials.remove('gw-00000001')).rejects.toThrow('Something else');
  });

  describe('reconcile', () => {
    const brokerUsers = (clients: { username: string; textdescription?: string }[]) => {
      broker.answer = (command) => {
        if (command.command === 'createRole') return { error: 'Role already exists' };
        if (command.command === 'listClients') {
          return { data: { totalCount: clients.length, clients } };
        }
        return {};
      };
    };

    it('sets the defaults and the role, then applies exactly the planned steps', async () => {
      wanted = [
        { id: 'gw-00000001', generation: 1 },
        { id: 'gw-00000002', generation: 2 },
        { id: 'gw-00000003', generation: 1 },
      ];
      brokerUsers([
        { username: 'gw-00000001', textdescription: 'generation:1' },
        { username: 'gw-00000002', textdescription: 'generation:1' },
        { username: 'gw-00000009', textdescription: 'generation:4' },
      ]);
      await make().reconcile();
      expect(broker.sent()).toEqual([
        {
          command: 'setDefaultACLAccess',
          acls: [
            { acltype: 'publishClientSend', allow: false },
            { acltype: 'publishClientReceive', allow: false },
            { acltype: 'subscribe', allow: false },
            { acltype: 'unsubscribe', allow: true },
          ],
        },
        { command: 'createRole', rolename: 'smart-gateway-ha' },
        {
          command: 'modifyRole',
          rolename: 'smart-gateway-ha',
          acls: [
            { acltype: 'publishClientSend', topic: 'gw/%u/ha/#', allow: true },
            { acltype: 'publishClientSend', topic: 'gw/%u/bridge/connection', allow: true },
          ],
        },
        { command: 'listClients', verbose: true },
        {
          command: 'setClientPassword',
          username: 'gw-00000002',
          password: deriveGatewayPassword(SECRET, 'gw-00000002', 2),
        },
        { command: 'modifyClient', username: 'gw-00000002', textdescription: 'generation:2' },
        {
          command: 'createClient',
          username: 'gw-00000003',
          password: deriveGatewayPassword(SECRET, 'gw-00000003', 1),
          clientid: 'gw-00000003-ha',
          textdescription: 'generation:1',
          roles: [{ rolename: 'smart-gateway-ha' }],
        },
        { command: 'deleteClient', username: 'gw-00000009' },
      ]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('sends nothing to an unchanged user', async () => {
      wanted = [{ id: 'gw-00000001', generation: 1 }];
      brokerUsers([{ username: 'gw-00000001', textdescription: 'generation:1' }]);
      await make().reconcile();
      expect(broker.names()).toEqual([
        'setDefaultACLAccess',
        'createRole',
        'modifyRole',
        'listClients',
      ]);
    });

    it('goes on after a failed step and logs it without the password', async () => {
      wanted = [
        { id: 'gw-00000001', generation: 1 },
        { id: 'gw-00000002', generation: 1 },
      ];
      brokerUsers([{ username: 'gw-00000009' }]);
      const answer = broker.answer;
      broker.answer = (command) =>
        command.command === 'createClient' && command.username === 'gw-00000001'
          ? { error: 'Client already exists' }
          : answer(command);
      await expect(make().reconcile()).resolves.toBeUndefined();
      expect(broker.names().slice(4)).toEqual(['createClient', 'createClient', 'deleteClient']);
      const text = logged();
      expect(text).toContain('createClient');
      expect(text).toContain('gw-00000001');
      expect(text).toContain('Client already exists');
      expect(text).not.toContain(deriveGatewayPassword(SECRET, 'gw-00000001', 1));
      expect(text).not.toContain(SECRET);
    });

    it('stops before the steps when the broker cannot be read, and tries again next time', async () => {
      wanted = [{ id: 'gw-00000001', generation: 1 }];
      broker.answer = (command) =>
        command.command === 'listClients' ? { error: 'Internal error' } : {};
      const credentials = make();
      await expect(credentials.reconcile()).resolves.toBeUndefined();
      expect(broker.names()).not.toContain('createClient');
      expect(logged()).toContain('Internal error');
      brokerUsers([]);
      await credentials.reconcile();
      expect(broker.names()).toContain('createClient');
    });

    it('stops when the broker does not answer', async () => {
      vi.useFakeTimers();
      broker.answer = () => 'silent';
      const credentials = make();
      const run = credentials.reconcile();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(run).resolves.toBeUndefined();
      expect(broker.names()).toEqual(['setDefaultACLAccess']);
      expect(logged()).toContain('timeout');
    });

    it('logs a failed database read without throwing', async () => {
      listActiveCredentials = () => Promise.reject(new Error('select failed for secret-ish'));
      brokerUsers([]);
      await expect(make().reconcile()).resolves.toBeUndefined();
      expect(warn.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0);
      expect(logged()).not.toContain('secret-ish');
    });

    it('never runs twice at once; calls meanwhile get one more run afterwards', async () => {
      brokerUsers([]);
      let release: () => void = () => undefined;
      listActiveCredentials = () =>
        new Promise((resolve) => {
          release = () => resolve(wanted);
        });
      const credentials = make();
      const first = credentials.reconcile();
      await settle();
      const firstRelease = release;
      const second = credentials.reconcile();
      const third = credentials.reconcile();
      await settle();
      // The second run has not started yet.
      expect(broker.names().filter((name) => name === 'setDefaultACLAccess')).toHaveLength(1);
      firstRelease();
      await first;
      await settle();
      expect(broker.names().filter((name) => name === 'setDefaultACLAccess')).toHaveLength(2);
      release();
      await Promise.all([second, third]);
      await settle();
      expect(broker.names().filter((name) => name === 'setDefaultACLAccess')).toHaveLength(2);
    });
  });

  describe('schedule', () => {
    const runs = (): number =>
      broker.names().filter((name) => name === 'setDefaultACLAccess').length;

    beforeEach(() => {
      broker.answer = (command) =>
        command.command === 'listClients' ? { data: { totalCount: 0, clients: [] } } : {};
    });

    it('runs at start when already connected, after every connect and every 10 minutes', async () => {
      vi.useFakeTimers();
      const credentials = make();
      credentials.onModuleInit();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs()).toBe(1);
      broker.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs()).toBe(2);
      await vi.advanceTimersByTimeAsync(10 * MINUTE_MS - 1);
      expect(runs()).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(runs()).toBe(3);
      credentials.onModuleDestroy();
      broker.connect();
      await vi.advanceTimersByTimeAsync(30 * MINUTE_MS);
      expect(runs()).toBe(3);
    });

    it('waits for the connection when not connected at start', async () => {
      vi.useFakeTimers();
      broker.connected = false;
      const credentials = make();
      credentials.onModuleInit();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs()).toBe(0);
      broker.connected = true;
      broker.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs()).toBe(1);
      credentials.onModuleDestroy();
    });
  });
});
