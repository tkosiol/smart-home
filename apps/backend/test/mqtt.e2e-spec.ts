import { inject } from 'vitest';
import { MqttConnection, MqttHealth } from '../src/platform/mqtt/index.js';

const env = inject('testEnv');

function connect(password: string, errors: Error[] = []): MqttConnection {
  return new MqttConnection({
    url: env.MQTT_URL,
    username: env.MQTT_USERNAME,
    password,
    clientId: `test-${Math.random().toString(16).slice(2)}`,
    onError: (error) => errors.push(error),
  });
}

describe('MqttConnection', () => {
  it('connects with valid credentials and reports up', async () => {
    const connection = connect(env.MQTT_PASSWORD);
    try {
      expect(await connection.waitUntilConnected(5000)).toBe(true);
      expect(new MqttHealth(connection).check()).toBe('up');
    } finally {
      await connection.close();
    }
  });

  it('stays down with a wrong password and reports the error instead of crashing', async () => {
    const errors: Error[] = [];
    const connection = connect('wrong-password', errors);
    try {
      expect(await connection.waitUntilConnected(3000)).toBe(false);
      expect(new MqttHealth(connection).check()).toBe('down');
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      await connection.close();
    }
  });
});
