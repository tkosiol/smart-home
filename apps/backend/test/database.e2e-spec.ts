import postgres from 'postgres';
import { inject } from 'vitest';
import {
  DatabaseHealth,
  createDatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const { DATABASE_URL } = inject('testEnv');

async function query<T extends Record<string, unknown>>(url: string, text: string): Promise<T[]> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end();
  }
}

describe('runMigrations', () => {
  it('enables TimescaleDB and records the migration on an empty database', async () => {
    const url = await createFreshDatabase(DATABASE_URL);
    await runMigrations(url);

    const extensions = await query<{ extname: string }>(
      url,
      "select extname from pg_extension where extname = 'timescaledb'",
    );
    const applied = await query<{ count: string }>(
      url,
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(extensions).toHaveLength(1);
    expect(applied[0]?.count).toBe('7');
  });

  it('is idempotent', async () => {
    const url = await createFreshDatabase(DATABASE_URL);
    await runMigrations(url);
    await runMigrations(url);

    const applied = await query<{ count: string }>(
      url,
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(applied[0]?.count).toBe('7');
  });
});

describe('createDatabaseConnection', () => {
  it('forces UTC per session even when the server default differs', async () => {
    const connection = createDatabaseConnection(DATABASE_URL);
    try {
      const rows = await connection.sql`show timezone`;
      expect(rows[0]?.TimeZone).toBe('UTC');
    } finally {
      await connection.sql.end();
    }
  });
});

describe('statement timeout', () => {
  it('sets 15 s per session and the server cancels a statement that runs longer', async () => {
    const connection = createDatabaseConnection(DATABASE_URL);
    try {
      const rows = await connection.sql`show statement_timeout`;
      expect(rows[0]?.statement_timeout).toBe('15s');
      // Lowered on one connection only, to keep the test short: the server enforces it.
      const reserved = await connection.sql.reserve();
      try {
        await reserved`set statement_timeout = '200ms'`;
        await expect(reserved`select pg_sleep(5)`).rejects.toMatchObject({ code: '57014' });
      } finally {
        reserved.release();
      }
    } finally {
      await connection.sql.end();
    }
  });
});

describe('DatabaseHealth', () => {
  it('reports up for a reachable database', async () => {
    const connection = createDatabaseConnection(DATABASE_URL);
    try {
      expect(await new DatabaseHealth(connection).check()).toBe('up');
    } finally {
      await connection.sql.end();
    }
  });

  it('reports down within the timeout for an unreachable database', async () => {
    const connection = createDatabaseConnection('postgres://smart:x@127.0.0.1:1/smart');
    const started = Date.now();
    try {
      expect(await new DatabaseHealth(connection).check(1000)).toBe('down');
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await connection.sql.end({ timeout: 0 });
    }
  });
});
