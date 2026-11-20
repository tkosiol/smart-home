import { randomBytes } from 'node:crypto';
import type { MqttConnection, Unsubscribe } from '../../../platform/mqtt/index.js';

const CONTROL_TOPIC = '$CONTROL/dynamic-security/v1';
const RESPONSE_TOPIC = `${CONTROL_TOPIC}/response`;
/** How long one command may take, from publishing to the response. */
const DYNSEC_TIMEOUT_MS = 5_000;

/** A command failed: the plugin's error text (`Client not found`), `timeout` or `closed`. */
export class DynsecError extends Error {
  override readonly name = 'DynsecError';

  constructor(
    message: string,
    /** The command that failed (`createClient`), for the log. */
    readonly command?: string,
  ) {
    super(message);
  }
}

interface Pending {
  correlationData: string;
  command: string | undefined;
  finish: (error: DynsecError | undefined, data?: Record<string, unknown>) => void;
}

interface Response {
  correlationData?: unknown;
  error?: unknown;
  data?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The responses of a response document (`{"responses":[…]}`); none for anything else. */
function responsesOf(payload: Buffer): Response[] {
  try {
    const document: unknown = JSON.parse(payload.toString('utf8'));
    if (!isRecord(document) || !Array.isArray(document.responses)) return [];
    return document.responses.filter(isRecord);
  } catch {
    return [];
  }
}

/**
 * Talks to Mosquitto's dynamic security plugin over the platform connection (spec 5.4). One
 * command at a time over $CONTROL/dynamic-security/v1; responses matched by correlationData; 5 s
 * timeout. Commands carry passwords: neither they nor the payloads are ever put into errors.
 */
export class DynsecClient {
  /**
   * The correlation data starts with a random part: other processes on the response topic (and
   * responses the broker queued in the persistent session for an earlier process) never match.
   */
  private readonly prefix = randomBytes(6).toString('hex');
  private counter = 0;
  private pending: Pending | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly unsubscribe: Unsubscribe;

  constructor(private readonly mqtt: MqttConnection) {
    this.unsubscribe = mqtt.subscribe(
      RESPONSE_TOPIC,
      (_topic, payload) => {
        this.onResponse(payload);
      },
      { qos: 1 },
    );
  }

  /** Resolves with the response's `data` (if any); rejects with `DynsecError`. */
  send(command: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const result = this.tail.then(() => this.exchange(command));
    this.tail = result.catch(() => undefined);
    return result;
  }

  /**
   * Ends the subscription and fails what is pending or comes later. Not with `keepSession`: a
   * released handler would leave responses unacknowledged (and the connection's delivery waiting),
   * and no later process can use them; the next one subscribes on its own start.
   */
  close(): void {
    this.closed = true;
    this.pending?.finish(new DynsecError('closed'));
    this.unsubscribe();
  }

  private exchange(command: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    if (this.closed) return Promise.reject(new DynsecError('closed'));
    this.counter += 1;
    const name = typeof command.command === 'string' ? command.command : undefined;
    const correlationData = `${this.prefix}-${this.counter}`;
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        correlationData,
        command: name,
        finish: (error, data) => {
          if (this.pending !== pending) return;
          this.pending = undefined;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(data);
        },
      };
      this.pending = pending;
      // Also covers a publish that never settles (the connection has no timeout of its own).
      const timer = setTimeout(() => {
        pending.finish(new DynsecError('timeout', name));
      }, DYNSEC_TIMEOUT_MS);
      timer.unref();
      this.mqtt
        .publish(CONTROL_TOPIC, JSON.stringify({ commands: [{ ...command, correlationData }] }), {
          qos: 1,
        })
        .catch((error: unknown) => {
          // The connection's own errors (`mqtt.notConnected`) never quote the payload.
          const reason = error instanceof Error ? error.message : 'publish failed';
          pending.finish(new DynsecError(reason, name));
        });
    });
  }

  private onResponse(payload: Buffer): void {
    const pending = this.pending;
    if (pending === undefined) return;
    const response = responsesOf(payload).find(
      (candidate) => candidate.correlationData === pending.correlationData,
    );
    if (response === undefined) return;
    if (response.error !== undefined) {
      const reason = typeof response.error === 'string' ? response.error : 'unknown error';
      pending.finish(new DynsecError(reason, pending.command));
      return;
    }
    pending.finish(undefined, isRecord(response.data) ? response.data : undefined);
  }
}
