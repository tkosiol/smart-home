import { loadEnv } from './platform/config/index.js';
import { runMigrations } from './platform/database/index.js';

const env = loadEnv(process.env);
await runMigrations(env.DATABASE_URL);
console.log('migrations applied');
