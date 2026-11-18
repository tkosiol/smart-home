import postgres from 'postgres';

const HOUR_MS = 3_600_000;
/** A refresh by the policy job may be running; it is short, so waiting a little is enough. */
const REFRESH_ATTEMPTS = 50;
const REFRESH_PAUSE_MS = 100;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Brings `measurements_hourly` up to date after the migrations. Two things can be missing:
 *
 * - History the refresh policy does not cover (it only looks back 7 days), e.g. right after the
 *   view was created on a database with old readings. "What is missing" is decided by comparing
 *   the oldest raw numeric reading (the aggregate ignores value_num IS NULL rows) with the oldest
 *   *materialized* bucket. The view itself cannot be asked (real-time aggregation also returns
 *   rows derived from raw data), so we read the materialization hypertable behind it, found via
 *   `timescaledb_information.continuous_aggregates`. Once the oldest raw hour is materialized,
 *   the next call finds nothing to do. The range backfilled is returned, `null` if none was.
 * - Hours whose readings a data migration changed: TimescaleDB logs them as invalidated, and a
 *   refresh over all closed hours that still have raw readings computes just those again (cheap
 *   when there are none). It must not start earlier: the retention policy's drop_chunks logs the
 *   dropped range as invalidated too, and refreshing that range from no raw data would delete
 *   the hourly history, which is kept for good.
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
    // Same boundary as the policy's end_offset: the most recent hour is served in real time.
    const to = new Date(Math.floor((Date.now() - HOUR_MS) / HOUR_MS) * HOUR_MS);
    const from = await oldestRawHour(sql);
    if (from === null || from >= to) {
      console.log('hourly aggregate: nothing to backfill');
      return null;
    }
    const backfilled = await backfillHistory(sql, from, to);
    await refresh(sql, from, to);
    return backfilled;
  } finally {
    await sql.end();
  }
}

/** The hour of the oldest raw numeric reading (the aggregate ignores value_num IS NULL rows). */
async function oldestRawHour(sql: postgres.Sql): Promise<Date | null> {
  const [raw] = await sql<
    { first: Date | null }[]
  >`select min(time) as first from measurements where value_num is not null`;
  return raw?.first ? new Date(Math.floor(raw.first.getTime() / HOUR_MS) * HOUR_MS) : null;
}

async function backfillHistory(
  sql: postgres.Sql,
  from: Date,
  to: Date,
): Promise<{ from: Date; to: Date } | null> {
  const [view] = await sql<{ schema: string; name: string }[]>`
    select materialization_hypertable_schema as schema, materialization_hypertable_name as name
    from timescaledb_information.continuous_aggregates
    where view_name = 'measurements_hourly'`;
  if (!view) throw new Error('continuous aggregate measurements_hourly is missing');
  const [mat] = await sql<{ first: Date | null }[]>`
    select min(bucket) as first from ${sql(view.schema)}.${sql(view.name)}`;

  if (mat?.first && mat.first <= from) {
    console.log('hourly aggregate: nothing to backfill');
    return null;
  }
  await refresh(sql, from, to);
  console.log(`hourly aggregate: backfilled ${from.toISOString()} to ${to.toISOString()}`);
  return { from, to };
}

/** Refreshes the window, waiting for a refresh that runs already. */
async function refresh(sql: postgres.Sql, from: Date, to: Date): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await sql.unsafe(
        `call refresh_continuous_aggregate('measurements_hourly', '${from.toISOString()}', '${to.toISOString()}')`,
      );
      return;
    } catch (error) {
      const concurrent = error instanceof Error && error.message.includes('concurrent refresh');
      if (!concurrent || attempt >= REFRESH_ATTEMPTS) throw error;
      await sleep(REFRESH_PAUSE_MS);
    }
  }
}
