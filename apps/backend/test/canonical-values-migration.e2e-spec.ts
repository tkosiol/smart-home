import postgres from 'postgres';
import { inject } from 'vitest';
import { backfillHourly } from '../src/core/telemetry/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { migrateUntil } from './helpers/migrate-until.js';

const { DATABASE_URL } = inject('testEnv');

const HOUR = 3_600_000;
const startOfHour = (t: number): number => Math.floor(t / HOUR) * HOUR;

describe('migration 0011_canonical_values', () => {
  let url: string;
  let sql: postgres.Sql;

  beforeEach(async () => {
    url = await createFreshDatabase(DATABASE_URL);
    await migrateUntil(url, '0010_adapter_layer');
    sql = postgres(url, { max: 1, connection: { TimeZone: 'UTC' }, onnotice: () => undefined });
    // The refresh policy must not run next to the refreshes of this test.
    await sql`select alter_job(job_id, scheduled => false) from timescaledb_information.jobs
      where proc_name = 'policy_refresh_continuous_aggregate'`;
  });

  afterEach(async () => {
    await sql.end();
  });

  it('moves lamp states, capabilities and readings to percent, kelvin and booleans', async () => {
    const [household] = await sql<{ id: string }[]>`insert into households (name, timezone)
      values ('Zuhause', 'Europe/Berlin') returning id`;
    await sql`insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint,
        cert_expires_at)
      values ('gw-mig00002', ${household.id}, 'Pi', 'gw/gw-mig00002/z2m', 'ab',
        ${new Date('2027-01-01T00:00:00Z')})`;
    const lastState = { state: 'ON', brightness: 254, color_temp: 370 };
    const [lamp] = await sql<{ id: string }[]>`insert into hardware (gateway_id, external_id, name,
        address, setup_state, last_state, first_seen_at)
      values ('gw-mig00002', '0x00124b0000000003', 'Lampe', 'Lampe', 'ready',
        ${sql.json(lastState)}, now())
      returning id`;
    const [device] = await sql<{ id: string }[]>`insert into devices (household_id, name)
      values (${household.id}, 'Lampe') returning id`;
    await sql`insert into device_bindings (device_id, hardware_id) values (${device.id}, ${lamp.id})`;
    const deviceState = { state: 'OFF', brightness: 0, color_temp: 0 };
    await sql`insert into device_state (device_id, state)
      values (${device.id}, ${sql.json(deviceState)})`;
    await sql`insert into capabilities (hardware_id, key, kind, unit, min, max, readable, writable,
        is_setting, native)
      values
        (${lamp.id}, 'brightness', 'numeric', null, 0, 254, true, true, true,
          ${sql.json({ property: 'brightness' })}),
        (${lamp.id}, 'color_temp', 'numeric', 'mired', 250, 454, true, true, true,
          ${sql.json({ property: 'color_temp' })}),
        (${lamp.id}, 'state', 'binary', null, null, null, true, true, true,
          ${sql.json({ property: 'state' })})`;
    const hour = startOfHour(Date.now()) - 3 * 24 * HOUR;
    const reading = (minute: number, capability: string, value: number) =>
      sql`insert into measurements (time, device_id, capability, value_num)
        values (${new Date(hour + minute * 60_000)}, ${device.id}, ${capability}, ${value})`;
    await reading(1, 'brightness', 254);
    await reading(2, 'brightness', 127);
    await reading(1, 'color_temp', 370);
    await reading(2, 'color_temp', 0);
    await reading(1, 'soil_moisture', 40);
    await sql`select compress_chunk(c) from show_chunks('measurements') c`;
    await sql.unsafe(
      `call refresh_continuous_aggregate('measurements_hourly', '${new Date(hour).toISOString()}', '${new Date(hour + HOUR).toISOString()}')`,
    );
    const maxBrightness = async (): Promise<number | undefined> => {
      const [row] = await sql<{ max: number }[]>`select max from measurements_hourly
        where device_id = ${device.id} and capability = 'brightness'`;
      return row?.max;
    };
    expect(await maxBrightness()).toBe(254);

    await runMigrations(url);
    await backfillHourly(url);

    const [hardware] = await sql<{ last_state: unknown }[]>`select last_state from hardware`;
    expect(hardware?.last_state).toEqual({ state: true, brightness: 100, color_temp: 2703 });
    const [state] = await sql<{ state: unknown }[]>`select state from device_state`;
    expect(state?.state).toEqual({ state: false, brightness: 0, color_temp: 0 });

    const capabilities = await sql<
      Record<string, unknown>[]
    >`select key, unit, min, max, step, is_setting, native from capabilities order by key`;
    expect(capabilities).toEqual([
      {
        key: 'brightness',
        unit: '%',
        min: 0,
        max: 100,
        step: null,
        is_setting: false,
        native: { property: 'brightness', max: 254 },
      },
      {
        key: 'color_temp',
        unit: 'K',
        min: 2203,
        max: 4000,
        step: null,
        is_setting: false,
        native: { property: 'color_temp' },
      },
      {
        key: 'state',
        unit: null,
        min: null,
        max: null,
        step: null,
        is_setting: false,
        native: { property: 'state' },
      },
    ]);

    const readings = await sql<{ capability: string; value_num: number }[]>`
      select capability, value_num from measurements order by capability, time`;
    expect(readings).toEqual([
      { capability: 'brightness', value_num: 100 },
      { capability: 'brightness', value_num: 50 },
      { capability: 'color_temp', value_num: 2703 },
      { capability: 'color_temp', value_num: 0 },
      { capability: 'soil_moisture', value_num: 40 },
    ]);
    // The hour that was materialized before is computed again.
    expect(await maxBrightness()).toBe(100);
  });
});
