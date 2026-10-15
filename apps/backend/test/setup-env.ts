import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';

Object.assign(process.env, inject('testEnv'), {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  // The test files share one broker and run in parallel: a client ID of their own each, or they
  // would take the connection from one another.
  MQTT_CLIENT_ID: `test-api-${randomBytes(4).toString('hex')}`,
});
