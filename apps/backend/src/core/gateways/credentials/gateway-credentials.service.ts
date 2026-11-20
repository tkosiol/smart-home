import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ENV, type Env } from '../../../platform/config/index.js';
import { describeError } from '../../../platform/errors/index.js';
import { MQTT_CONNECTION, MqttConnection } from '../../../platform/mqtt/index.js';
import { CLOCK, type Clock } from '../../identity/index.js';
import { GatewaysRepository } from '../gateways.repository.js';
import { Throttle } from '../throttle.js';
import { DynsecClient, DynsecError } from './dynsec.js';
import { deriveGatewayPassword, gatewayClientId, generationTag } from './password.js';
import { planReconcile, type BrokerClient, type ClientStep } from './reconcile-plan.js';

const HOUR_MS = 3_600_000;
/** Reconcile period (spec 5.4); a run also follows every connect of the backend. */
const RECONCILE_INTERVAL_MS = 600_000;
const ROLE = 'smart-gateway-ha';

/** Everything forbidden by default for users of the plugin, except unsubscribing. */
const DEFAULT_ACL_ACCESS = [
  { acltype: 'publishClientSend', allow: false },
  { acltype: 'publishClientReceive', allow: false },
  { acltype: 'subscribe', allow: false },
  { acltype: 'unsubscribe', allow: true },
];
/** A paired gateway publishes below its own prefix (`%u` is the user name = gateway ID) only. */
const ROLE_ACLS = [
  { acltype: 'publishClientSend', topic: 'gw/%u/ha/#', allow: true },
  { acltype: 'publishClientSend', topic: 'gw/%u/bridge/connection', allow: true },
];

/**
 * The failure text that may be logged: the command and the plugin's own words, else only the kind
 * of error (never a payload: commands carry passwords).
 */
export const reasonOf = (error: unknown): string =>
  error instanceof DynsecError
    ? `${error.command ?? 'command'}: ${error.message}`
    : describeError(error);

/**
 * The users of the dynamic security plugin, as `listClients` with `verbose: true` gives them
 * (measured with Mosquitto 2.1.2): `data.clients` is a list of objects with `username` and, when
 * set, `textdescription` (also `clientid`, `roles`, `groups`, `connections`).
 */
function brokerClientsOf(data: Record<string, unknown> | undefined): BrokerClient[] {
  const clients = data?.clients;
  if (!Array.isArray(clients)) throw new DynsecError('unexpected response', 'listClients');
  return clients.map((client: unknown) => {
    const { username, textdescription } = (client ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string') throw new DynsecError('unexpected response', 'listClients');
    return typeof textdescription === 'string' ? { username, textdescription } : { username };
  });
}

/**
 * The broker users of the gateways paired from the app (spec 5.3, 5.4): their keys are derived
 * from `GATEWAY_CREDENTIAL_SECRET`, and a reconcile after every connect and every 10 minutes
 * makes the plugin's users match the database. Measured with Mosquitto 2.1.2: `setClientPassword`
 * and `modifyClient` (even for the description only) and `deleteClient` disconnect the user, while
 * `setDefaultACLAccess`, `createRole` and `modifyRole` with unchanged rules do not; so an unchanged
 * user gets no command at all. Failures are logged without passwords or payloads and never crash
 * the app; the next run tries again.
 */
@Injectable()
export class GatewayCredentials implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayCredentials.name);
  /** Available when the secret is configured. */
  readonly enabled: boolean;
  private readonly secret: string | undefined;
  private readonly dynsec: DynsecClient;
  private readonly notices = new Throttle(HOUR_MS, 1);
  /** Reconcile runs and exclusive sections, one after the other. */
  private tail: Promise<unknown> = Promise.resolve();
  /** A reconcile run that is waiting for its turn (not started yet). */
  private waitingRun: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private removeConnectListener: (() => void) | undefined;

  constructor(
    private readonly repository: GatewaysRepository,
    @Inject(MQTT_CONNECTION) private readonly mqtt: MqttConnection,
    @Inject(ENV) env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.secret = env.GATEWAY_CREDENTIAL_SECRET;
    this.enabled = this.secret !== undefined;
    this.dynsec = new DynsecClient(mqtt);
  }

  onModuleInit(): void {
    // onConnect only reports connects from now on: one that happened already gets its run here.
    this.removeConnectListener = this.mqtt.onConnect(() => {
      void this.reconcile();
    });
    this.timer = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
    this.timer.unref();
    if (this.mqtt.isConnected()) void this.reconcile();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.removeConnectListener?.();
    this.dynsec.close();
  }

  password(gatewayId: string, generation: number): string {
    if (this.secret === undefined) throw new Error('GATEWAY_CREDENTIAL_SECRET is not set');
    return deriveGatewayPassword(this.secret, gatewayId, generation);
  }

  /**
   * A user that exists already (only possible after a pairing whose commit failed) gets the
   * requested generation's key instead.
   */
  async create(gatewayId: string, generation: number): Promise<void> {
    try {
      await this.dynsec.send({
        command: 'createClient',
        username: gatewayId,
        password: this.password(gatewayId, generation),
        clientid: gatewayClientId(gatewayId),
        textdescription: generationTag(generation),
        roles: [{ rolename: ROLE }],
      });
    } catch (error) {
      if (!(error instanceof DynsecError && error.message === 'Client already exists')) throw error;
      await this.rekey(gatewayId, generation);
    }
  }

  /**
   * Disconnects the gateway (both commands do). The generation goes first: should the password
   * step fail, the description differs from the database (whose transaction rolls back), and the
   * next reconcile sets the key that belongs to it. The other order could leave a new password
   * under an old description, which no reconcile would notice.
   */
  async rekey(gatewayId: string, generation: number): Promise<void> {
    await this.dynsec.send({
      command: 'modifyClient',
      username: gatewayId,
      textdescription: generationTag(generation),
    });
    await this.dynsec.send({
      command: 'setClientPassword',
      username: gatewayId,
      password: this.password(gatewayId, generation),
    });
  }

  async remove(gatewayId: string): Promise<void> {
    try {
      await this.dynsec.send({ command: 'deleteClient', username: gatewayId });
    } catch (error) {
      if (!(error instanceof DynsecError && error.message === 'Client not found')) throw error;
    }
  }

  /**
   * Spec 5.4 steps 1–3. Never runs twice at once nor during an exclusive section: a call meanwhile
   * gets one more run afterwards (shared by all such calls; it sees what changed meanwhile).
   * Never rejects.
   */
  reconcile(): Promise<void> {
    this.waitingRun ??= this.serialize(async () => {
      // Started: a call from now on needs a run of its own.
      this.waitingRun = undefined;
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error(`Gateway credentials reconcile failed (${describeError(error)})`);
      }
    });
    return this.waitingRun;
  }

  /**
   * Runs `fn` while no reconcile is in progress and holds new runs back until it settles (a
   * pairing's database transaction and broker step): a run that read the database before the
   * commit would undo the step. Settles as `fn` does.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.serialize(fn);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async runOnce(): Promise<void> {
    if (!this.enabled) {
      if (this.notices.allow('secret', this.clock())) {
        this.logger.warn(
          'GATEWAY_CREDENTIAL_SECRET is not set: gateways paired from the app cannot connect',
        );
      }
      return;
    }
    let steps: ClientStep[];
    try {
      await this.dynsec.send({ command: 'setDefaultACLAccess', acls: DEFAULT_ACL_ACCESS });
      await this.ensureRole();
      const actual = brokerClientsOf(
        await this.dynsec.send({ command: 'listClients', verbose: true }),
      );
      // Single steps from elsewhere (create, rekey, remove) must run inside exclusive().
      steps = planReconcile(await this.repository.listActiveCredentials(), actual);
    } catch (error) {
      this.logger.warn(`Gateway credentials reconcile failed (${reasonOf(error)})`);
      return;
    }
    for (const step of steps) {
      try {
        await this.apply(step);
      } catch (error) {
        const id = step.kind === 'delete' ? step.username : step.id;
        this.logger.warn(`Gateway credentials: ${step.kind} of ${id} failed (${reasonOf(error)})`);
      }
    }
  }

  private async ensureRole(): Promise<void> {
    try {
      await this.dynsec.send({ command: 'createRole', rolename: ROLE });
    } catch (error) {
      if (!(error instanceof DynsecError && error.message === 'Role already exists')) throw error;
    }
    // Replaces the role's rules; with unchanged rules, nobody is disconnected.
    await this.dynsec.send({ command: 'modifyRole', rolename: ROLE, acls: ROLE_ACLS });
  }

  private apply(step: ClientStep): Promise<void> {
    switch (step.kind) {
      case 'create':
        return this.create(step.id, step.generation);
      case 'rekey':
        return this.rekey(step.id, step.generation);
      case 'delete':
        return this.remove(step.username);
    }
  }
}
