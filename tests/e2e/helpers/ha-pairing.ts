import { readFileSync } from 'node:fs';
import path from 'node:path';
import { connectAsync, type MqttClient } from 'mqtt';
import { BASE_URL } from './env';

/** What the API answers when a code is redeemed: the paired gateway's access to the broker. */
export interface PairedAccess {
  gatewayId: string;
  mqttUrl: string;
  username: string;
  password: string;
  clientId: string;
}

/** A pairing code as the app shows it: two groups of four Crockford base32 characters. */
export const PAIRING_CODE = /[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;

/** The protocol examples that the integration and the backend's adapter are both tested against. */
const FIXTURES = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'integrations',
  'home-assistant',
  'fixtures',
);
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), 'utf8');

/**
 * Redeems `code` like the integration `smart_bridge` does: a plain POST to the app's address,
 * without a session and without an Origin. `name` becomes the gateway's name.
 */
export async function redeemPairingCode(code: string, name: string): Promise<PairedAccess> {
  const response = await fetch(new URL('/api/v1/gateway-pairing/redeem', BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  if (response.status !== 200) {
    throw new Error(`redeeming the code answered ${String(response.status)}`);
  }
  return (await response.json()) as PairedAccess;
}

/**
 * Plays Home Assistant: connects to `mqttUrl` (the websocket behind the web nginx) with the
 * access from the answer, then announces itself and its devices like the integration, retained
 * and with QoS 1: the bridge and Home Assistant are online, the device list of the fixtures and
 * the state of the floor lamp ("Stehlampe"). The caller ends the connection.
 */
export async function connectAsHomeAssistant(access: PairedAccess): Promise<MqttClient> {
  const client = await connectAsync(access.mqttUrl, {
    username: access.username,
    password: access.password,
    clientId: access.clientId,
    reconnectPeriod: 0,
    connectTimeout: 10_000,
  });
  const publish = (topic: string, payload: string) =>
    client.publishAsync(`gw/${access.gatewayId}/${topic}`, payload, { qos: 1, retain: true });
  const devices = fixture('devices.json');
  const lamp = (
    JSON.parse(devices) as { devices: { id: string; name: string | null }[] }
  ).devices.find((device) => device.name === 'Stehlampe');
  if (!lamp) throw new Error('devices.json has no "Stehlampe"');
  await publish('bridge/connection', '1');
  await publish('ha/status', 'online');
  await publish('ha/devices', devices);
  await publish(`ha/device/${lamp.id}`, fixture('device-lamp-on.json'));
  return client;
}
