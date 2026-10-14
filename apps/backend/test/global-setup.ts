import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { startTestBroker, TEST_MQTT_PASSWORD, TEST_MQTT_USER } from './helpers/test-broker.js';

export const TEST_APP_ORIGIN = 'http://localhost:4200';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [database, broker] = await Promise.all([
    new PostgreSqlContainer('timescale/timescaledb:2.30.2-pg17')
      .withDatabase('smart')
      .withUsername('smart')
      .withPassword('smart-test')
      // A non-UTC server default proves that our client forces UTC per session.
      .withCommand(['postgres', '-c', 'timezone=Europe/Berlin'])
      .start(),
    startTestBroker(),
  ]);

  project.provide('testEnv', {
    DATABASE_URL: database.getConnectionUri(),
    MQTT_URL: `mqtt://${broker.getHost()}:${broker.getMappedPort(1883)}`,
    MQTT_USERNAME: TEST_MQTT_USER,
    MQTT_PASSWORD: TEST_MQTT_PASSWORD,
    APP_ORIGIN: TEST_APP_ORIGIN,
  });

  return async () => {
    await Promise.all([broker.stop(), database.stop()]);
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    testEnv: Record<
      'DATABASE_URL' | 'MQTT_URL' | 'MQTT_USERNAME' | 'MQTT_PASSWORD' | 'APP_ORIGIN',
      string
    >;
  }
}
