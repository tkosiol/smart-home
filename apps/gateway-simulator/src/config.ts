import { GATEWAY_ID_PATTERN } from '@smart/contracts';

export interface SimulatorConfig {
  mqttUrl: string;
  username: string;
  password: string;
  gatewayId: string;
  /** Seconds between two reports of the devices. */
  intervalSeconds: number;
  /** Seed of the random numbers; the same seed gives the same course of the values. */
  seed: number;
}

export const DEFAULT_INTERVAL_SECONDS = 300;

type Environment = Readonly<Record<string, string | undefined>>;

function required(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

function parseInterval(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_INTERVAL_SECONDS;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error('INTERVAL_SECONDS must be a whole number of seconds, at least 1');
  }
  return seconds;
}

/** An unset seed gives a different course on every start; a given one must be a whole number. */
function parseSeed(raw: string | undefined): number {
  if (raw === undefined || raw === '') return Date.now() % 2 ** 32;
  const seed = Number(raw);
  if (!Number.isSafeInteger(seed)) throw new Error('SEED must be a whole number');
  return seed;
}

/** Reads the settings from the environment; the messages never quote a secret value. */
export function parseConfig(env: Environment): SimulatorConfig {
  const gatewayId = required(env, 'GATEWAY_ID');
  if (!GATEWAY_ID_PATTERN.test(gatewayId)) {
    throw new Error('GATEWAY_ID must match gw-[a-z0-9]{8}');
  }
  return {
    mqttUrl: required(env, 'MQTT_URL'),
    username: required(env, 'MQTT_USERNAME'),
    password: required(env, 'MQTT_PASSWORD'),
    gatewayId,
    intervalSeconds: parseInterval(env['INTERVAL_SECONDS']),
    seed: parseSeed(env['SEED']),
  };
}
