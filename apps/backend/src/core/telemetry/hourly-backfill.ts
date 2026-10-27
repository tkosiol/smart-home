import postgres from 'postgres';

const HOUR_MS = 3_600_000;

/**
 * Materializes `measurements_hourly` for history the refresh policy does not cover (it only
 * looks back 7 days), e.g. right after the view was created on a database with old readings.
 *
 * Only numeric readings count (the aggregate ignores value_num IS NULL rows).
 * "What is missing" is decided by comparing the oldest raw reading with the oldest
 * *materialized* bucket. The view itself cannot be asked (real-time aggregation also returns
 * rows derived from raw data), so we read the materialization hypertable behind it, found
 * via `timescaledb_information.continuous_aggregates`. Once the oldest raw hour is
 * materialized, the next call finds nothing to do and returns null.
 *
 * `CALL refresh_continuous_aggregate` cannot run inside a transaction, so this uses its own
 * connection and is not part of the (transactional) drizzle migrations.
 */
export async function backfillHourly(url: string): Promise<{ from: Date; to: Date } | null> {
  const sql = postgres(url, {
    max: 1,
    connection: { TimeZone: 'UTC' },
    onnotice: () => undefined,
  });
  try {
    const [raw] = await sql<
      { first: Date | null }[]
    >`select min(time) as first from measurements where value_num is not null`;
    if (!raw?.first) {
      console.log('hourly aggregate: nothing to backfill');
      return null;
    }
    const [view] = await sql<{ schema: string; name: string }[]>`
      select materialization_hypertable_schema as schema, materialization_hypertable_name as name
      from timescaledb_information.continuous_aggregates
      where view_name = 'measurements_hourly'`;
    if (!view) throw new Error('continuous aggregate measurements_hourly is missing');
    const [mat] = await sql<{ first: Date | null }[]>`
      select min(bucket) as first from ${sql(view.schema)}.${sql(view.name)}`;

    const from = new Date(Math.floor(raw.first.getTime() / HOUR_MS) * HOUR_MS);
    // Same boundary as the policy's end_offset: the most recent hour is served in real time.
    const to = new Date(Math.floor((Date.now() - HOUR_MS) / HOUR_MS) * HOUR_MS);
    if ((mat?.first && mat.first <= from) || from >= to) {
      console.log('hourly aggregate: nothing to backfill');
      return null;
    }
    await sql.unsafe(
      `call refresh_continuous_aggregate('measurements_hourly', '${from.toISOString()}', '${to.toISOString()}')`,
    );
    console.log(`hourly aggregate: backfilled ${from.toISOString()} to ${to.toISOString()}`);
    return { from, to };
  } finally {
    await sql.end();
  }
}
