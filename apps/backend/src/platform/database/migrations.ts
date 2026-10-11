import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** apps/backend/drizzle – resolves from src/ (tests) and dist/ (container) alike. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, {
    max: 1,
    connection: { TimeZone: 'UTC' },
    onnotice: () => undefined,
  });
  try {
    await migrate(drizzle(sql), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
  } finally {
    await sql.end();
  }
}
