-- Hand-written: drizzle cannot express continuous aggregates. Keep this part when regenerating.
-- WITH NO DATA keeps this inside the migrator's transaction; the history is filled by
-- backfillHourly() (src/core/telemetry/hourly-backfill.ts), which runs after the migrations.
-- materialized_only = false: the running hour is aggregated from raw rows at query time.
CREATE MATERIALIZED VIEW measurements_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  device_id,
  capability,
  avg(value_num) AS avg,
  min(value_num) AS min,
  max(value_num) AS max,
  last(value_num, time) AS last,
  sum(value_num) AS sum,
  count(value_num) AS count
FROM measurements
WHERE value_num IS NOT NULL
GROUP BY 1, 2, 3
WITH NO DATA;--> statement-breakpoint
SELECT add_continuous_aggregate_policy('measurements_hourly',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes');
