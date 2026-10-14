import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

const brokerFile = (name: string): string =>
  fileURLToPath(new URL(`../../../infra/broker/${name}`, import.meta.url));

export const TEST_MQTT_USER = 'smart-api';
export const TEST_MQTT_PASSWORD = 'smart-test';
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
    new GenericContainer('eclipse-mosquitto:2.1.2-alpine')
      .withCopyFilesToContainer([
        { source: brokerFile('mosquitto.conf'), target: '/mosquitto/config/mosquitto.conf' },
        { source: brokerFile('tls.conf'), target: '/mosquitto/config/tls.conf' },
        { source: brokerFile('acl'), target: '/mosquitto/config/acl' },
        { source: brokerFile('entrypoint.sh'), target: '/smart/entrypoint.sh' },
      ])
      .withEntrypoint(['/bin/sh', '/smart/entrypoint.sh'])
      .withEnvironment({ MQTT_USER: TEST_MQTT_USER, MQTT_PASSWORD: TEST_MQTT_PASSWORD })
      .withExposedPorts(1883)
      .withWaitStrategy(Wait.forLogMessage(/running/))
      .start(),
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
