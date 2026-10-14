import { connect, type IClientOptions } from 'mqtt';
import type { SimulatorConfig } from './config.js';
import type { Z2mDevice } from './fixtures.js';
import { GatewaySimulation, type Report } from './model.js';

/** The part of the mqtt.js client the simulator uses (the tests replace it). */
export interface MqttClientLike {
  on(event: 'connect', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'message', listener: (topic: string, payload: Buffer) => void): unknown;
  publishAsync(
    topic: string,
    payload: string,
    options: { qos: 0 | 1; retain: boolean },
  ): Promise<unknown>;
  subscribeAsync(topic: string, options: { qos: 0 | 1 }): Promise<unknown>;
  endAsync(force?: boolean): Promise<unknown>;
}

export interface GatewayDeps {
  connect?: (url: string, options: IClientOptions) => MqttClientLike;
  now?: () => Date;
  log?: (message: string) => void;
}

/** The connection options; the last will is what the broker publishes when the simulator dies. */
export function clientOptions(config: SimulatorConfig): IClientOptions {
  return {
    username: config.username,
    password: config.password,
    // Not the gateway ID: that is the client ID of a real gateway with this ID.
    clientId: `${config.gatewayId}-simulator`,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 2000,
    will: {
      topic: `gw/${config.gatewayId}/bridge/connection`,
      payload: Buffer.from('0'),
      qos: 1,
      retain: true,
    },
  };
}

/** Behaves like the Raspberry Pi's gateway: bridge state, device list, device messages and `set` commands. */
export class Gateway {
  private readonly client: MqttClientLike;
  private readonly simulation: GatewaySimulation;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private readonly connectionTopic: string;
  private readonly z2mPrefix: string;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: SimulatorConfig,
    private readonly fixtures: readonly Z2mDevice[],
    deps: GatewayDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((message) => console.log(message));
    this.connectionTopic = `gw/${config.gatewayId}/bridge/connection`;
    this.z2mPrefix = `gw/${config.gatewayId}/z2m/`;
    this.simulation = new GatewaySimulation(fixtures, config.seed, this.now());
    this.client = (deps.connect ?? defaultConnect)(config.mqttUrl, clientOptions(config));
    this.client.on('connect', () => {
      this.onConnect().catch((error: unknown) => this.logError(error));
    });
    this.client.on('error', (error) => this.logError(error));
    this.client.on('message', (topic, payload) => this.onMessage(topic, payload));
  }

  private async onConnect(): Promise<void> {
    this.log(`connected as gateway ${this.config.gatewayId}`);
    await this.publish(this.connectionTopic, '1', 1, true);
    await this.publishZ2m('bridge/state', { state: 'online' }, 1, true);
    await this.publishZ2m('bridge/devices', this.fixtures, 1, true);
    await this.publishReports(this.simulation.availability());
    await this.client.subscribeAsync(`${this.z2mPrefix}+/set`, { qos: 1 });
    await this.publishReports(this.simulation.tick(this.now()));
    this.timer ??= setInterval(() => {
      this.publishReports(this.simulation.tick(this.now())).catch((error: unknown) =>
        this.logError(error),
      );
    }, this.config.intervalSeconds * 1000);
  }

  private onMessage(topic: string, payload: Buffer): void {
    if (!topic.startsWith(this.z2mPrefix) || !topic.endsWith('/set')) return;
    const name = topic.slice(this.z2mPrefix.length, -'/set'.length);
    let command: unknown;
    try {
      command = JSON.parse(payload.toString('utf8'));
    } catch {
      return; // not JSON: ignored like Zigbee2MQTT does for an unusable command
    }
    this.publishReports(this.simulation.set(name, command, this.now())).catch((error: unknown) =>
      this.logError(error),
    );
  }

  /** Says goodbye (`0` on the connection topic) and disconnects. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try {
      // Without a connection the message would wait for one; then the last will does the job.
      await Promise.race([this.publish(this.connectionTopic, '0', 1, true), timeout(3000)]);
    } finally {
      await this.client.endAsync(true);
    }
  }

  private publishReports(reports: readonly Report[]): Promise<unknown> {
    return Promise.all(
      reports.map((report) =>
        this.publishZ2m(report.topic, report.payload, report.retain ? 1 : 0, report.retain),
      ),
    );
  }

  private publishZ2m(
    topic: string,
    payload: unknown,
    qos: 0 | 1,
    retain: boolean,
  ): Promise<unknown> {
    return this.publish(`${this.z2mPrefix}${topic}`, JSON.stringify(payload), qos, retain);
  }

  private publish(topic: string, payload: string, qos: 0 | 1, retain: boolean): Promise<unknown> {
    return this.client.publishAsync(topic, payload, { qos, retain });
  }

  // Only the message of the error: it never carries the password or a payload.
  private logError(error: unknown): void {
    this.log(`error: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function defaultConnect(url: string, options: IClientOptions): MqttClientLike {
  return connect(url, options);
}
