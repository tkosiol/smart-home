import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inject } from 'vitest';
import { CliModule } from '../src/cli.module.js';
import { UsersRepository } from '../src/core/identity/index.js';
import { MQTT_CONNECTION } from '../src/platform/mqtt/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

describe('CLI context', () => {
  let context: INestApplicationContext;
  const originalUrl = inject('testEnv').DATABASE_URL;

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    context = await NestFactory.createApplicationContext(CliModule, { logger: false });
  });

  afterAll(async () => {
    await context.close();
    process.env.DATABASE_URL = originalUrl;
  });

  it('has what the commands use', () => {
    expect(context.get(UsersRepository)).toBeInstanceOf(UsersRepository);
  });

  it('has no MQTT connection, so that it never joins the api session at the broker', () => {
    expect(() => {
      context.get(MQTT_CONNECTION, { strict: false });
    }).toThrow();
  });
});
