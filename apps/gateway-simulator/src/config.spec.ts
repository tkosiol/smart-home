import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERVAL_SECONDS, parseConfig } from './config.js';

const valid = {
  MQTT_URL: 'mqtt://broker:1883',
  MQTT_USERNAME: 'smart-simulator',
  MQTT_PASSWORD: 'secret-value',
  GATEWAY_ID: 'gw-abcd1234',
};

describe('parseConfig', () => {
  it('reads the settings and defaults the interval to 300 seconds', () => {
    const config = parseConfig({ ...valid, SEED: '42' });
    expect(config).toEqual({
      mqttUrl: 'mqtt://broker:1883',
      username: 'smart-simulator',
      password: 'secret-value',
      gatewayId: 'gw-abcd1234',
      intervalSeconds: DEFAULT_INTERVAL_SECONDS,
      seed: 42,
    });
    expect(DEFAULT_INTERVAL_SECONDS).toBe(300);
  });

  it('takes the interval from the environment, and treats empty values as unset', () => {
    expect(parseConfig({ ...valid, INTERVAL_SECONDS: '10' }).intervalSeconds).toBe(10);
    const empty = parseConfig({ ...valid, INTERVAL_SECONDS: '', SEED: '' });
    expect(empty.intervalSeconds).toBe(300);
    expect(Number.isSafeInteger(empty.seed)).toBe(true);
  });

  it.each(['gw-ABCD1234', 'gw-abcd123', 'gw-abcd12345', 'abcd1234', 'gw-abcd123\n', ''])(
    'rejects the gateway ID %j',
    (id) => {
      expect(() => parseConfig({ ...valid, GATEWAY_ID: id })).toThrow(/GATEWAY_ID/);
    },
  );

  it.each(['MQTT_URL', 'MQTT_USERNAME', 'MQTT_PASSWORD'])('requires %s', (name) => {
    expect(() => parseConfig({ ...valid, [name]: undefined })).toThrow(name);
  });

  it.each(['0', '-5', '1.5', 'abc'])('rejects the interval %j', (value) => {
    expect(() => parseConfig({ ...valid, INTERVAL_SECONDS: value })).toThrow(/INTERVAL_SECONDS/);
  });

  it('rejects a seed that is not a whole number', () => {
    expect(() => parseConfig({ ...valid, SEED: 'x' })).toThrow(/SEED/);
  });

  it('never quotes the password in an error', () => {
    expect(() => parseConfig({ ...valid, GATEWAY_ID: 'bad' })).not.toThrow(/secret-value/);
  });
});
