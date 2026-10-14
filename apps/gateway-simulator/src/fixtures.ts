import { readFileSync } from 'node:fs';

/** One entry of Zigbee2MQTT's `bridge/devices` message; only the fields the simulator reads are typed. */
export interface Z2mDevice {
  friendly_name: string;
  ieee_address: string;
  type: string;
  definition?: { model: string; exposes: Z2mExpose[] };
  [key: string]: unknown;
}

export interface Z2mExpose {
  type: string;
  name?: string;
  property?: string;
  access?: number;
  unit?: string;
  value_min?: number;
  value_max?: number;
  value_on?: string | boolean;
  value_off?: string | boolean;
  values?: string[];
  features?: Z2mExpose[];
}

/** Z2M real definitions with invented IEEE addresses and names, see fixtures/devices.json. */
export function loadFixtureDevices(): Z2mDevice[] {
  const file = new URL('../fixtures/devices.json', import.meta.url);
  const devices: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(devices)) throw new Error('fixtures/devices.json must hold a list of devices');
  return devices as Z2mDevice[];
}
