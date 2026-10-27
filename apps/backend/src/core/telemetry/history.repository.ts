import { Inject, Injectable } from '@nestjs/common';
import type { HistoryDay, HistoryPoint, HistoryResolution } from '@smart/contracts';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';

interface PointRow {
  t: string;
  avg: number | string;
  min: number | string;
  max: number | string;
  last: number | string;
}

interface DayRow extends Omit<PointRow, 't'> {
  date: string;
  partial: boolean;
}

/** Read side of the measurements: bucketed series for charts. */
@Injectable()
export class HistoryRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /**
   * Numeric readings in buckets of `resolution`, ascending. A bucket is included when it starts at
   * or after the bucket containing `from` and before `to`, so the first bucket may start before
   * `from`. 15 minutes come from the raw table, hours from the continuous aggregate.
   */
  async points(
    deviceId: string,
    capability: string,
    from: Date,
    to: Date,
    resolution: HistoryResolution,
  ): Promise<HistoryPoint[]> {
    const { sql } = this.connection;
    const [fromIso, toIso] = [from.toISOString(), to.toISOString()];
    const rows =
      resolution === '15m'
        ? await sql<PointRow[]>`
            select to_char(time_bucket('15 minutes', time) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as t, avg(value_num) as avg,
              min(value_num) as min, max(value_num) as max, last(value_num, time) as last
            from measurements
            where device_id = ${deviceId} and capability = ${capability}
              and value_num is not null
              and time >= time_bucket('15 minutes', ${fromIso}::timestamptz) and time < ${toIso}::timestamptz
            group by time_bucket('15 minutes', time) order by time_bucket('15 minutes', time)`
        : await sql<PointRow[]>`
            select to_char(bucket at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as t, avg, min, max, last
            from measurements_hourly
            where device_id = ${deviceId} and capability = ${capability}
              and bucket >= time_bucket('1 hour', ${fromIso}::timestamptz) and bucket < ${toIso}::timestamptz
            order by bucket`;
    return rows.map((row) => ({
      t: new Date(row.t).toISOString(),
      avg: Number(row.avg),
      min: Number(row.min),
      max: Number(row.max),
      last: Number(row.last),
    }));
  }

  /**
   * Calendar days of `timeZone` built from the hourly buckets of [`from`, `to`), ascending. A day
   * is `partial` when it starts before `from` or ends after `to`. Day length follows the zone
   * (23, 24 or 25 hours); the end is computed in local time.
   */
  async days(
    deviceId: string,
    capability: string,
    from: Date,
    to: Date,
    timeZone: string,
  ): Promise<HistoryDay[]> {
    const [fromIso, toIso] = [from.toISOString(), to.toISOString()];
    const rows = await this.connection.sql<DayRow[]>`
      select to_char(day at time zone ${timeZone}, 'YYYY-MM-DD') as date,
        avg, min, max, last,
        (day < ${fromIso}::timestamptz
          or ((day at time zone ${timeZone}) + interval '1 day') at time zone ${timeZone}
            > ${toIso}::timestamptz) as partial
      from (
        select time_bucket('1 day', bucket, ${timeZone}) as day,
          sum(sum) / sum(count) as avg, min(min) as min, max(max) as max,
          last(last, bucket) as last
        from measurements_hourly
        where device_id = ${deviceId} and capability = ${capability}
          and bucket >= time_bucket('1 hour', ${fromIso}::timestamptz) and bucket < ${toIso}::timestamptz
        group by 1
      ) d
      order by day`;
    return rows.map((row) => ({
      date: row.date,
      avg: Number(row.avg),
      min: Number(row.min),
      max: Number(row.max),
      last: Number(row.last),
      partial: row.partial,
    }));
  }
}
