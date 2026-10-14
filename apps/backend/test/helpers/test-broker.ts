import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const brokerFile = (name: string): string =>
  fileURLToPath(new URL(`../../../../infra/broker/${name}`, import.meta.url));

export const TEST_MQTT_USER = 'smart-api';
export const TEST_MQTT_PASSWORD = 'smart-test';

/**
 * The broker of the stack (same configuration, ACL and entrypoint, plain listener). With
 * `hostPort` the container keeps that port on the host across restarts; a random port may change.
 */
export function startTestBroker(hostPort?: number): Promise<StartedTestContainer> {
  return new GenericContainer('eclipse-mosquitto:2.1.2-alpine')
    .withCopyFilesToContainer([
      { source: brokerFile('mosquitto.conf'), target: '/mosquitto/config/mosquitto.conf' },
      { source: brokerFile('tls.conf'), target: '/mosquitto/config/tls.conf' },
      { source: brokerFile('acl'), target: '/mosquitto/config/acl' },
      { source: brokerFile('entrypoint.sh'), target: '/smart/entrypoint.sh' },
    ])
    .withEntrypoint(['/bin/sh', '/smart/entrypoint.sh'])
    .withEnvironment({ MQTT_USER: TEST_MQTT_USER, MQTT_PASSWORD: TEST_MQTT_PASSWORD })
    .withExposedPorts(hostPort === undefined ? 1883 : { container: 1883, host: hostPort })
    .withWaitStrategy(Wait.forLogMessage(/running/))
    .start();
}
