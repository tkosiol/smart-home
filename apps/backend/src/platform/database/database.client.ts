import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export interface DatabaseConnection {
  readonly db: PostgresJsDatabase;
  readonly sql: postgres.Sql;
}

/** A statement that runs longer is cancelled by the server: a stuck query must not hold a connection. */
const STATEMENT_TIMEOUT_MS = 15_000;

/** All sessions run in UTC, independent of the server default (spec §9). */
export function createDatabaseConnection(url: string): DatabaseConnection {
  const sql = postgres(url, {
    max: 10,
    connect_timeout: 5,
    connection: {
      TimeZone: 'UTC',
      application_name: 'smart-api',
      statement_timeout: STATEMENT_TIMEOUT_MS,
    },
    onnotice: () => undefined,
  });
  return { sql, db: drizzle(sql) };
}
