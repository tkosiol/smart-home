import postgres from 'postgres';
import { inject } from 'vitest';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { migrateUntil } from './helpers/migrate-until.js';

const { DATABASE_URL } = inject('testEnv');

describe('migration 0010_adapter_layer', () => {
  let url: string;
  let sql: postgres.Sql;

  beforeEach(async () => {
    url = await createFreshDatabase(DATABASE_URL);
    await migrateUntil(url, '0009_measurements_hourly');
    sql = postgres(url, { max: 1, connection: { TimeZone: 'UTC' }, onnotice: () => undefined });
  });

  afterEach(async () => {
    await sql.end();
  });

  it('renames the Zigbee2MQTT columns to neutral ones and keeps their values', async () => {
    const definition = { model: 'TS0601', exposes: [{ property: 'soil_moisture' }] };
    const [household] = await sql<{ id: string }[]>`insert into households (name, timezone)
      values ('Zuhause', 'Europe/Berlin') returning id`;
    await sql`insert into gateways (id, household_id, name, topic_prefix, z2m_status,
        cert_fingerprint, cert_expires_at)
      values ('gw-mig00001', ${household.id}, 'Pi', 'gw/gw-mig00001/z2m', 'online', 'ab',
        ${new Date('2027-01-01T00:00:00Z')})`;
    const [ready] = await sql<{ id: string }[]>`insert into hardware (gateway_id, ieee_address,
        friendly_name, definition, interview_state, first_seen_at)
      values ('gw-mig00001', '0x00124b0000000001', 'Monstera', ${sql.json(definition)},
        'SUCCESSFUL', now())
      returning id`;
    const [pairing] = await sql<{ id: string }[]>`insert into hardware (gateway_id, ieee_address,
        friendly_name, interview_state, first_seen_at)
      values ('gw-mig00001', '0x00124b0000000002', 'Lampe', 'IN_PROGRESS', now())
      returning id`;
    await sql`insert into capabilities (hardware_id, key, kind, readable, writable, is_setting)
      values (${ready.id}, 'soil_moisture', 'numeric', true, false, false),
        (${pairing.id}, 'state', 'binary', true, true, false)`;

    await runMigrations(url);

    const hardware = await sql<
      {
        id: string;
        external_id: string;
        name: string;
        address: string;
        setup_state: string;
        native: unknown;
      }[]
    >`select id, external_id, name, address, setup_state, native from hardware order by external_id`;
    expect(hardware).toEqual([
      {
        id: ready.id,
        external_id: '0x00124b0000000001',
        name: 'Monstera',
        address: 'Monstera',
        setup_state: 'ready',
        native: definition,
      },
      {
        id: pairing.id,
        external_id: '0x00124b0000000002',
        name: 'Lampe',
        address: 'Lampe',
        setup_state: 'pairing',
        native: {},
      },
    ]);
    const capabilities = await sql<{ key: string; native: unknown }[]>`select key, native
      from capabilities order by key`;
    expect(capabilities).toEqual([
      { key: 'soil_moisture', native: { property: 'soil_moisture' } },
      { key: 'state', native: { property: 'state' } },
    ]);
    const [gateway] = await sql<{ service_status: string }[]>`select service_status from gateways`;
    expect(gateway?.service_status).toBe('online');

    await expect(sql`insert into hardware (gateway_id, external_id, name, setup_state,
        first_seen_at)
      values ('gw-mig00001', '0x00124b0000000003', 'Neu', 'SUCCESSFUL', now())`).rejects.toThrow(
      /hardware_setup_state_check/,
    );
    const [fresh] = await sql<{ setup_state: string; address: string | null }[]>`insert into
        hardware (gateway_id, external_id, name, first_seen_at)
      values ('gw-mig00001', '0x00124b0000000004', 'Neu', now())
      returning setup_state, address`;
    expect(fresh).toEqual({ setup_state: 'unknown', address: null });
  });
});
