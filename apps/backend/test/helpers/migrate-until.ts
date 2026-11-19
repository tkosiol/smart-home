import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { MIGRATIONS_FOLDER } from '../../src/platform/database/index.js';

interface Journal {
  entries: { tag: string }[];
}

/**
 * Migrates the database only up to and including the migration tagged `lastTag` (e.g.
 * `'0009_measurements_hourly'`), so that a test can insert rows in the old format. A later
 * `runMigrations(url)` applies the rest: Drizzle remembers applied migrations by their time.
 */
export async function migrateUntil(url: string, lastTag: string): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'smart-migrations-'));
  try {
    await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Journal;
    const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
    if (last < 0) throw new Error(`no migration tagged ${lastTag}`);
    const kept = journal.entries.slice(0, last + 1);
    await writeFile(journalPath, JSON.stringify({ ...journal, entries: kept }));
    const keptFiles = new Set(kept.map((entry) => `${entry.tag}.sql`));
    for (const file of await readdir(folder)) {
      if (file.endsWith('.sql') && !keptFiles.has(file)) await rm(join(folder, file));
    }

    const sql = postgres(url, {
      max: 1,
      connection: { TimeZone: 'UTC' },
      onnotice: () => undefined,
    });
    try {
      await migrate(drizzle(sql), {
        migrationsFolder: folder,
        migrationsSchema: 'drizzle',
        migrationsTable: '__drizzle_migrations',
      });
    } finally {
      await sql.end();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
