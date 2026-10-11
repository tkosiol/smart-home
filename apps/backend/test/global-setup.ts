import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await new PostgreSqlContainer('timescale/timescaledb:2.30.2-pg17')
    .withDatabase('smart')
    .withUsername('smart')
    .withPassword('smart-test')
    // A non-UTC server default proves that our client forces UTC per session.
    .withCommand(['postgres', '-c', 'timezone=Europe/Berlin'])
    .start();

  project.provide('testEnv', {
    DATABASE_URL: database.getConnectionUri(),
    MQTT_URL: 'mqtt://127.0.0.1:1',
    MQTT_USERNAME: 'unused',
    MQTT_PASSWORD: 'unused',
  });

  return async () => {
    await database.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    testEnv: Record<'DATABASE_URL' | 'MQTT_URL' | 'MQTT_USERNAME' | 'MQTT_PASSWORD', string>;
  }
}
