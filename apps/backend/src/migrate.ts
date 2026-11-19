import { backfillHourly } from './core/telemetry/index.js';
import { loadEnv } from './platform/config/index.js';
import { runMigrations } from './platform/database/index.js';

const env = loadEnv(process.env);
await runMigrations(env.DATABASE_URL);
// Also computes again the hours whose readings a data migration changed (0011: lamp units).
await backfillHourly(env.DATABASE_URL);
console.log('migrations applied');
