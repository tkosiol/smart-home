import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgres://smart:secret@db:5432/smart',
  MQTT_URL: 'mqtt://broker:1883',
  MQTT_USERNAME: 'smart-api',
  MQTT_PASSWORD: 'mqtt-secret',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces PORT to a number', () => {
    expect(loadEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('accepts postgresql:// and mqtts:// URLs', () => {
    const env = loadEnv({
      ...valid,
      DATABASE_URL: 'postgresql://a:b@h/d',
      MQTT_URL: 'mqtts://h:8883',
    });
    expect(env.MQTT_URL).toBe('mqtts://h:8883');
  });

  it('names every missing variable', () => {
    expect(() => loadEnv({})).toThrowError(
      /DATABASE_URL[\s\S]*MQTT_URL[\s\S]*MQTT_USERNAME[\s\S]*MQTT_PASSWORD/,
    );
  });

  it('never echoes secret values in the error', () => {
    let message = '';
    try {
      loadEnv({
        ...valid,
        DATABASE_URL: 'mysql://smart:super-secret-pw@db/smart',
        PORT: 'not-a-port',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message).not.toContain('super-secret-pw');
  });
});
