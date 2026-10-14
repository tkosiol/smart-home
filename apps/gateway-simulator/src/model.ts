import type { Z2mDevice } from './fixtures.js';
import { Random } from './random.js';

/** A message below `gw/<id>/z2m/`: the topic is relative to that prefix. */
export interface Report {
  topic: string;
  payload: Record<string, unknown>;
  retain: boolean;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const PLANT_MODEL = 'AY-303Z';
export const LAMP_MODEL = 'LED1624G9';
export const LAMP = {
  brightnessMax: 254,
  colorTempMin: 153,
  colorTempMax: 500,
} as const;
/** Soil moisture (%) below which the sensor reports `dry`; also reported as its `soil_warning` setting. */
export const SOIL_WARNING = 30;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const round1 = (value: number): number => Math.round(value * 10) / 10;

interface SimulatedDevice {
  readonly name: string;
  readonly available: boolean;
  /** Moves the device to `now` and returns its state, or nothing while it is offline. */
  advance(now: Date): Record<string, unknown> | undefined;
}

class PlantSensor implements SimulatedDevice {
  private soil: number;
  private rate: number;
  private nextWatering: number;
  private battery: number;
  private readonly batteryPerDay: number;
  private readonly baseTemperature: number;
  private lastMs: number;
  available: boolean;

  /** `offlineHour` is the UTC hour of the day in which this sensor is out of reach, or undefined. */
  constructor(
    readonly name: string,
    private readonly random: Random,
    start: Date,
    private readonly offlineHour: number | undefined,
  ) {
    this.soil = random.between(45, 85);
    this.rate = random.between(0.5, 2);
    this.nextWatering = start.getTime() + random.between(0.5, 4.5) * DAY_MS;
    this.battery = random.between(60, 100);
    this.batteryPerDay = random.between(0.05, 0.3);
    this.baseTemperature = random.between(19, 23);
    this.lastMs = start.getTime();
    this.available = !this.isOffline(start);
  }

  isOffline(now: Date): boolean {
    return this.offlineHour !== undefined && now.getUTCHours() === this.offlineHour;
  }

  advance(now: Date): Record<string, unknown> | undefined {
    const nowMs = now.getTime();
    const hours = Math.max(0, nowMs - this.lastMs) / HOUR_MS;
    this.lastMs = Math.max(this.lastMs, nowMs);
    this.soil -= this.rate * hours;
    if (nowMs >= this.nextWatering) {
      // Watering: the soil jumps to a new level and dries out at a new pace until the next one.
      this.soil = this.random.between(70, 90);
      this.rate = this.random.between(0.5, 2);
      this.nextWatering = nowMs + this.random.between(3, 5) * DAY_MS;
    }
    this.soil = clamp(this.soil, 0, 100);
    this.battery = clamp(this.battery - (this.batteryPerDay * hours) / 24, 0, 100);

    this.available = !this.isOffline(now);
    if (!this.available) return undefined;

    const hourOfDay = now.getUTCHours() + now.getUTCMinutes() / 60;
    const temperature = clamp(
      this.baseTemperature +
        2 * Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI) +
        this.random.between(-0.3, 0.3),
      5,
      40,
    );
    const humidity = clamp(55 - (temperature - 21) * 2 + this.random.between(-3, 3), 20, 90);
    const soilMoisture = Math.round(this.soil);
    return {
      battery: Math.round(this.battery),
      dry: soilMoisture < SOIL_WARNING,
      humidity: Math.round(humidity),
      humidity_calibration: 0,
      linkquality: this.random.int(60, 200),
      soil_calibration: 0,
      soil_moisture: soilMoisture,
      soil_sampling: 300,
      soil_warning: SOIL_WARNING,
      temperature: round1(temperature),
      temperature_calibration: 0,
      temperature_sampling: 300,
      temperature_unit: 'celsius',
    };
  }
}

class Lamp implements SimulatedDevice {
  readonly available = true;
  private on = false;
  private brightness: number = LAMP.brightnessMax;
  private colorTemp = 370;

  constructor(
    readonly name: string,
    private readonly random: Random,
  ) {}

  advance(): Record<string, unknown> {
    return {
      brightness: this.brightness,
      color_temp: this.colorTemp,
      linkquality: this.random.int(60, 200),
      power_on_behavior: 'previous',
      state: this.on ? 'ON' : 'OFF',
    };
  }

  /** Takes over what a `set` message carries; returns whether anything was applied. */
  apply(command: unknown): boolean {
    if (typeof command !== 'object' || command === null || Array.isArray(command)) return false;
    const { state, brightness, color_temp: colorTemp } = command as Record<string, unknown>;
    let applied = false;
    if (typeof brightness === 'number' && Number.isFinite(brightness)) {
      this.brightness = clamp(Math.round(brightness), 0, LAMP.brightnessMax);
      // As the lamp does: a brightness without a state switches it on, zero switches it off.
      if (state === undefined) this.on = this.brightness > 0;
      applied = true;
    }
    if (typeof colorTemp === 'number' && Number.isFinite(colorTemp)) {
      this.colorTemp = clamp(Math.round(colorTemp), LAMP.colorTempMin, LAMP.colorTempMax);
      applied = true;
    }
    if (typeof state === 'string') {
      const value = state.toUpperCase();
      if (value === 'ON' || value === 'OFF') {
        this.on = value === 'ON';
        applied = true;
      } else if (value === 'TOGGLE') {
        this.on = !this.on;
        applied = true;
      }
    }
    return applied;
  }
}

/** The devices of one gateway and how their values develop; knows nothing about MQTT. */
export class GatewaySimulation {
  private readonly devices: SimulatedDevice[] = [];
  private readonly lamps = new Map<string, Lamp>();

  /**
   * `fixtures` are the entries of `bridge/devices`: AY-303Z becomes a soil sensor and LED1624G9 a lamp,
   * anything else (the coordinator) is only listed. One sensor is unreachable for one hour of every day.
   */
  constructor(fixtures: readonly Z2mDevice[], seed: number, start: Date) {
    const random = new Random(seed);
    const sensors = fixtures.filter((device) => device.definition?.model === PLANT_MODEL);
    const offlineSensor = sensors.length > 0 ? random.int(0, sensors.length - 1) : -1;
    const offlineHour = random.int(0, 23);
    let sensorIndex = 0;
    for (const device of fixtures) {
      const model = device.definition?.model;
      if (model === PLANT_MODEL) {
        const hour = sensorIndex === offlineSensor ? offlineHour : undefined;
        this.devices.push(new PlantSensor(device.friendly_name, random, start, hour));
        sensorIndex += 1;
      } else if (model === LAMP_MODEL) {
        const lamp = new Lamp(device.friendly_name, random);
        this.lamps.set(lamp.name, lamp);
        this.devices.push(lamp);
      }
    }
  }

  /** Retained `<name>/availability` messages for the current state of every device. */
  availability(): Report[] {
    return this.devices.map((device) => availabilityReport(device));
  }

  /** The regular report: every reachable device's state, and an availability message for each change. */
  tick(now: Date): Report[] {
    const reports: Report[] = [];
    for (const device of this.devices) {
      const wasAvailable = device.available;
      const state = device.advance(now);
      if (device.available !== wasAvailable) reports.push(availabilityReport(device));
      if (state) reports.push(stateReport(device.name, state, now));
    }
    return reports;
  }

  /** A `set` message for the lamp of that name: the new state is reported at once. */
  set(name: string, command: unknown, now: Date): Report[] {
    const lamp = this.lamps.get(name);
    if (!lamp?.apply(command)) return [];
    return [stateReport(name, lamp.advance(), now)];
  }
}

function availabilityReport(device: SimulatedDevice): Report {
  return {
    topic: `${device.name}/availability`,
    payload: { state: device.available ? 'online' : 'offline' },
    retain: true,
  };
}

function stateReport(name: string, state: Record<string, unknown>, now: Date): Report {
  return { topic: name, payload: { ...state, last_seen: now.toISOString() }, retain: false };
}
