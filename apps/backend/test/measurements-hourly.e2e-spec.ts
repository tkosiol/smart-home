import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { inject } from 'vitest';
import { backfillHourly } from '../src/core/telemetry/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const { DATABASE_URL } = inject('testEnv');

interface Row {
  bucket: Date;
  avg: number;
  min: number;
  max: number;
  last: number;
  sum: number;
  count: string;
}

const HOUR = 3_600_000;
const startOfHour = (t: number): number => Math.floor(t / HOUR) * HOUR;

describe('measurements_hourly', () => {
  let url: string;
  let sql: postgres.Sql;
  const deviceId = randomUUID();

  async function insert(at: number, value: number, capability = 'soil_moisture'): Promise<void> {
    await sql`insert into measurements (time, device_id, capability, value_num)
      values (${new Date(at)}, ${deviceId}, ${capability}, ${value})`;
  }

  async function hourly(capability = 'soil_moisture'): Promise<Row[]> {
    return sql<Row[]>`select bucket, avg, min, max, last, sum, count::text as count
      from measurements_hourly where device_id = ${deviceId} and capability = ${capability}
      order by bucket`;
  }

  beforeEach(async () => {
    url = await createFreshDatabase(DATABASE_URL);
    await runMigrations(url);
    sql = postgres(url, { max: 1, connection: { TimeZone: 'UTC' }, onnotice: () => undefined });
  });

  afterEach(async () => {
    await sql.end();
  });

  it('aggregates readings per hour once refreshed', async () => {
    const base = startOfHour(Date.now()) - 5 * HOUR;
    await insert(base + 60_000, 10);
    await insert(base + 120_000, 30);
    await insert(base + 180_000, 20);
    await insert(base + HOUR + 60_000, 50);
    await insert(base + 2 * HOUR + 60_000, 5);
    await insert(base + 2 * HOUR + 120_000, 7);
    await sql`insert into measurements (time, device_id, capability, value_text)
      values (${new Date(base + 1000)}, ${deviceId}, 'soil_moisture', 'text')`;
    await sql.unsafe(
      `call refresh_continuous_aggregate('measurements_hourly', '${new Date(base).toISOString()}', '${new Date(base + 3 * HOUR).toISOString()}')`,
    );

    const rows = await hourly();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ avg: 20, min: 10, max: 30, last: 20, sum: 60, count: '3' });
    expect(rows[1]).toMatchObject({ avg: 50, min: 50, max: 50, last: 50, sum: 50, count: '1' });
    expect(rows[2]).toMatchObject({ avg: 6, min: 5, max: 7, last: 7, sum: 12, count: '2' });
  });

  it('shows the running hour immediately (real-time aggregation)', async () => {
    const now = Date.now();
    await insert(now - 1000, 42);
    const rows = await hourly();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ avg: 42, count: '1' });
    expect(rows[0]?.bucket.getTime()).toBe(startOfHour(now - 1000));
  });

  it('backfills old readings once and is a no-op afterwards', async () => {
    const old = startOfHour(Date.now()) - 20 * 24 * HOUR;
    await insert(old + 60_000, 1);
    await insert(old + 120_000, 3);
    await insert(old + 5 * HOUR, 9);

    const range = await backfillHourly(url);
    expect(range).not.toBeNull();
    expect(range?.from.getTime()).toBe(old);
    expect(range!.to.getTime()).toBeLessThanOrEqual(Date.now() - HOUR + 1000);

    const rows = await hourly();
    expect(rows.map((r) => r.count)).toEqual(['2', '1']);
    expect(rows[0]).toMatchObject({ avg: 2, min: 1, max: 3 });

    expect(await backfillHourly(url)).toBeNull();
  });

  it('returns null on an empty database', async () => {
    expect(await backfillHourly(url)).toBeNull();
  });

  it('picks up late-delivered readings after a refresh of their window', async () => {
    const base = startOfHour(Date.now()) - 10 * HOUR;
    await insert(base + 60_000, 10);
    expect(await backfillHourly(url)).not.toBeNull();
    await insert(base + 120_000, 30);

    // Not materialized yet: the closed hour still shows the stale aggregate.
    expect((await hourly())[0]).toMatchObject({ count: '1' });
    await sql.unsafe(
      `call refresh_continuous_aggregate('measurements_hourly', '${new Date(base).toISOString()}', '${new Date(base + HOUR).toISOString()}')`,
    );
    expect((await hourly())[0]).toMatchObject({ avg: 20, count: '2' });
  });
});
