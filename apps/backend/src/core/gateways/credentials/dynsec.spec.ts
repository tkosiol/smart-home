import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MqttConnection,
  MqttMessageHandler,
  SubscribeOptions,
} from '../../../platform/mqtt/index.js';
import { DynsecClient, DynsecError } from './dynsec.js';

const TOPIC = '$CONTROL/dynamic-security/v1';
const RESPONSE_TOPIC = `${TOPIC}/response`;

/** Stands in for the platform connection: records publishes, lets the test answer. */
class FakeMqtt {
  readonly published: { topic: string; payload: string; qos: number | undefined }[] = [];
  readonly subscriptions: { filter: string; options: SubscribeOptions | undefined }[] = [];
  readonly ended: ({ keepSession?: boolean } | undefined)[] = [];
  private handler: MqttMessageHandler | undefined;
  publishResult: () => Promise<void> = () => Promise.resolve();

  subscribe(filter: string, handler: MqttMessageHandler, options?: SubscribeOptions) {
    this.subscriptions.push({ filter, options });
    this.handler = handler;
    return (ending?: { keepSession?: boolean }) => {
      this.ended.push(ending);
    };
  }

  publish(topic: string, payload: string | Buffer, options?: { qos?: 0 | 1 }): Promise<void> {
    this.published.push({ topic, payload: payload.toString(), qos: options?.qos });
    return this.publishResult();
  }

  /** The command document of the n-th publish. */
  command(index: number): Record<string, unknown> {
    const sent = this.published[index];
    if (!sent) throw new Error(`nothing published at ${index}`);
    const document = JSON.parse(sent.payload) as { commands: Record<string, unknown>[] };
    const [command] = document.commands;
    if (!command || document.commands.length !== 1) throw new Error('not one command');
    return command;
  }

  respond(body: unknown): void {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    void this.handler?.(RESPONSE_TOPIC, Buffer.from(raw), false);
  }

  /** Answers the n-th command with the given fields, under its own correlation data. */
  answer(index: number, fields: Record<string, unknown> = {}): void {
    const command = this.command(index);
    this.respond({
      responses: [
        { command: command.command, correlationData: command.correlationData, ...fields },
      ],
    });
  }
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe('DynsecClient', () => {
  let mqtt: FakeMqtt;
  let client: DynsecClient;

  beforeEach(() => {
    mqtt = new FakeMqtt();
    client = new DynsecClient(mqtt as unknown as MqttConnection);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to the response topic once, at QoS 1', () => {
    expect(mqtt.subscriptions).toEqual([{ filter: RESPONSE_TOPIC, options: { qos: 1 } }]);
  });

  it('sends one command with correlation data to the control topic', async () => {
    const result = client.send({ command: 'listClients', verbose: true });
    await flush();
    expect(mqtt.published).toHaveLength(1);
    expect(mqtt.published[0]?.topic).toBe(TOPIC);
    expect(mqtt.published[0]?.qos).toBe(1);
    const command = mqtt.command(0);
    expect(command).toMatchObject({ command: 'listClients', verbose: true });
    expect(typeof command.correlationData).toBe('string');
    mqtt.answer(0, { data: { totalCount: 0, clients: [] } });
    await expect(result).resolves.toEqual({ totalCount: 0, clients: [] });
  });

  it('gives every command its own correlation data', async () => {
    const first = client.send({ command: 'createRole', rolename: 'r' });
    await flush();
    mqtt.answer(0);
    await first;
    const second = client.send({ command: 'createRole', rolename: 'r' });
    await flush();
    mqtt.answer(1);
    await second;
    expect(mqtt.command(0).correlationData).not.toBe(mqtt.command(1).correlationData);
  });

  it('resolves undefined for a response without data', async () => {
    const result = client.send({ command: 'deleteClient', username: 'gw-00000001' });
    await flush();
    mqtt.answer(0);
    await expect(result).resolves.toBeUndefined();
  });

  it('ignores responses for other commands and payloads that are not responses', async () => {
    let settled = false;
    const result = client.send({ command: 'listClients' });
    void result.then(() => (settled = true));
    await flush();
    mqtt.respond({ responses: [{ command: 'listClients', correlationData: 'someone-else' }] });
    mqtt.respond({ responses: [{ command: 'listClients' }] });
    mqtt.respond('not json');
    mqtt.respond({ other: true });
    await flush();
    expect(settled).toBe(false);
    mqtt.answer(0, { data: { clients: [] } });
    await expect(result).resolves.toEqual({ clients: [] });
  });

  it('finds its response among several in one document', async () => {
    const result = client.send({ command: 'getRole', rolename: 'r' });
    await flush();
    mqtt.respond({
      responses: [
        { command: 'getRole', correlationData: 'x' },
        { command: 'getRole', correlationData: mqtt.command(0).correlationData, data: { a: 1 } },
      ],
    });
    await expect(result).resolves.toEqual({ a: 1 });
  });

  it('rejects with the error of the plugin', async () => {
    const result = client.send({ command: 'deleteClient', username: 'gw-00000001' });
    await flush();
    mqtt.answer(0, { error: 'Client not found' });
    await expect(result).rejects.toMatchObject({
      name: 'DynsecError',
      message: 'Client not found',
    });
    await expect(result).rejects.toBeInstanceOf(DynsecError);
  });

  it('rejects with timeout after 5 s without a response', async () => {
    vi.useFakeTimers();
    const result = client.send({ command: 'listClients' });
    const expectation = expect(result).rejects.toMatchObject({
      name: 'DynsecError',
      message: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(4_999);
    await vi.advanceTimersByTimeAsync(1);
    await expectation;
  });

  it('times out a publish that never settles', async () => {
    vi.useFakeTimers();
    mqtt.publishResult = () => new Promise<void>(() => undefined);
    const result = client.send({ command: 'listClients' });
    const expectation = expect(result).rejects.toMatchObject({
      name: 'DynsecError',
      message: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
  });

  it('rejects at once when the publish fails', async () => {
    mqtt.publishResult = () => Promise.reject(new Error('mqtt.notConnected'));
    await expect(client.send({ command: 'listClients' })).rejects.toMatchObject({
      name: 'DynsecError',
      message: 'mqtt.notConnected',
    });
  });

  it('sends the second command only after the first is done', async () => {
    const first = client.send({ command: 'createRole', rolename: 'r' });
    const second = client.send({ command: 'modifyRole', rolename: 'r' });
    await flush();
    expect(mqtt.published).toHaveLength(1);
    mqtt.answer(0, { error: 'Role already exists' });
    await expect(first).rejects.toThrow('Role already exists');
    await flush();
    expect(mqtt.published).toHaveLength(2);
    expect(mqtt.command(1).command).toBe('modifyRole');
    mqtt.answer(1);
    await expect(second).resolves.toBeUndefined();
  });

  it('goes on after a command timed out', async () => {
    vi.useFakeTimers();
    const first = client.send({ command: 'listClients' });
    const firstFailed = expect(first).rejects.toThrow('timeout');
    const second = client.send({ command: 'listClients' });
    await vi.advanceTimersByTimeAsync(5_000);
    await firstFailed;
    expect(mqtt.published).toHaveLength(2);
    // A late answer to the first command does not settle the second one.
    mqtt.answer(0, { data: { late: true } });
    mqtt.answer(1, { data: { clients: [] } });
    await expect(second).resolves.toEqual({ clients: [] });
  });

  it('closes: ends the subscription, rejects what is pending and refuses new commands', async () => {
    const pending = client.send({ command: 'listClients' });
    await flush();
    client.close();
    await expect(pending).rejects.toMatchObject({ name: 'DynsecError', message: 'closed' });
    await expect(client.send({ command: 'listClients' })).rejects.toMatchObject({
      name: 'DynsecError',
      message: 'closed',
    });
    expect(mqtt.ended).toEqual([undefined]);
  });
});
