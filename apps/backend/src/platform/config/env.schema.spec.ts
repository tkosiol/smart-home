import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgres://smart:secret@db:5432/smart',
  MQTT_URL: 'mqtt://broker:1883',
  MQTT_USERNAME: 'smart-api',
  MQTT_PASSWORD: 'mqtt-secret',
  APP_ORIGIN: 'https://smart.example.org',
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
      /DATABASE_URL[\s\S]*MQTT_URL[\s\S]*MQTT_USERNAME[\s\S]*MQTT_PASSWORD[\s\S]*APP_ORIGIN/,
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

  describe('APP_ORIGIN', () => {
    it('accepts a bare origin, including a port', () => {
      expect(loadEnv({ ...valid, APP_ORIGIN: 'http://localhost:4200' }).APP_ORIGIN).toBe(
        'http://localhost:4200',
      );
    });

    it.each(['https://smart.example.org/', 'https://smart.example.org/app', 'not-a-url'])(
      'rejects %s (must equal what a browser sends as Origin)',
      (APP_ORIGIN) => {
        expect(() => loadEnv({ ...valid, APP_ORIGIN })).toThrowError(/APP_ORIGIN/);
      },
    );
  });

  describe('mail settings', () => {
    it('leaves mail off without SMTP_URL and allows MAIL_FROM alone', () => {
      const env = loadEnv({ ...valid, MAIL_FROM: 'Smart Home <noreply@example.org>' });
      expect(env.SMTP_URL).toBeUndefined();
      expect(env.MAIL_FROM).toBe('Smart Home <noreply@example.org>');
    });

    it('treats empty values as unset', () => {
      const env = loadEnv({ ...valid, SMTP_URL: '', MAIL_FROM: '', MAIL_ALLOWLIST: '' });
      expect(env.SMTP_URL).toBeUndefined();
      expect(env.MAIL_FROM).toBeUndefined();
      expect(env.MAIL_ALLOWLIST).toBeUndefined();
    });

    it('requires MAIL_FROM when SMTP_URL is set', () => {
      expect(() => loadEnv({ ...valid, SMTP_URL: 'smtp://127.0.0.1:1026' })).toThrowError(
        /MAIL_FROM/,
      );
    });

    it('accepts smtp and smtps URLs and rejects other protocols', () => {
      const MAIL_FROM = 'noreply@example.org';
      expect(
        loadEnv({ ...valid, MAIL_FROM, SMTP_URL: 'smtps://u:p@smtp.example.org:465' }),
      ).toMatchObject({
        SMTP_URL: 'smtps://u:p@smtp.example.org:465',
      });
      expect(() =>
        loadEnv({ ...valid, MAIL_FROM, SMTP_URL: 'http://smtp.example.org' }),
      ).toThrowError(/SMTP_URL/);
    });

    it('splits and normalizes MAIL_ALLOWLIST', () => {
      const env = loadEnv({ ...valid, MAIL_ALLOWLIST: ' Till@Example.org, ,b@example.org ' });
      expect(env.MAIL_ALLOWLIST).toEqual(['till@example.org', 'b@example.org']);
    });

    it('never echoes the SMTP credentials in the error', () => {
      let message = '';
      try {
        loadEnv({ ...valid, SMTP_URL: 'smtps://resend:smtp-secret-key@smtp.example.org' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('MAIL_FROM');
      expect(message).not.toContain('smtp-secret-key');
    });
  });
});
