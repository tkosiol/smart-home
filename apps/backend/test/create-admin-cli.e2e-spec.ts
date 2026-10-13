import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { runCli, UsersRepository } from '../src/core/identity/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

describe('create-admin command', () => {
  let context: INestApplicationContext;
  let users: UsersRepository;
  const originalUrl = inject('testEnv').DATABASE_URL;

  const run = async (...args: string[]): Promise<{ code: number; out: string; err: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, users, {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    // The same way src/cli.ts starts: the full module graph, no HTTP server.
    context = await NestFactory.createApplicationContext(AppModule, { logger: false });
    users = context.get(UsersRepository);
  });

  afterAll(async () => {
    await context.close();
    process.env.DATABASE_URL = originalUrl;
  });

  it('creates a platform admin with the German locale and normalizes the address', async () => {
    const result = await run(
      'create-admin',
      '--email',
      '  Till.Admin@Example.ORG ',
      '--name',
      'Till',
    );
    expect(result.code).toBe(0);
    const user = await users.findByEmail('till.admin@example.org');
    expect(user).toMatchObject({
      email: 'till.admin@example.org',
      displayName: 'Till',
      locale: 'de',
      isPlatformAdmin: true,
    });
    expect(result.out).toContain('t***@example.org');
    expect(result.out).not.toContain('Till.Admin');
  });

  it('is idempotent: a second run changes nothing and creates no second user', async () => {
    await run('create-admin', '--email', 'twice@example.org', '--name', 'First');
    const before = await users.findByEmail('twice@example.org');
    const result = await run('create-admin', '--email', 'TWICE@example.org', '--name', 'Other');
    expect(result.code).toBe(0);
    const after = await users.findByEmail('twice@example.org');
    expect(after).toEqual(before);
    expect(after?.displayName).toBe('First');
  });

  it('only promotes an existing user and keeps the profile', async () => {
    await users.create({ email: 'member@example.org', displayName: 'Member', locale: 'en' });
    const result = await run('create-admin', '--email', 'member@example.org', '--name', 'Ignored');
    expect(result.code).toBe(0);
    expect(await users.findByEmail('member@example.org')).toMatchObject({
      displayName: 'Member',
      locale: 'en',
      isPlatformAdmin: true,
    });
  });

  it('exits 1 with a message for an invalid address and creates nobody', async () => {
    const result = await run('create-admin', '--email', 'not-an-email', '--name', 'Nobody');
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/e-?mail/i);
    expect(await users.findByEmail('not-an-email')).toBeUndefined();
  });

  it('exits 1 for a missing option and 2 for an unknown command', async () => {
    expect((await run('create-admin', '--email', 'x@example.org')).code).toBe(1);
    expect((await run('create-admin', '--name', 'X')).code).toBe(1);
    const unknown = await run('drop-database');
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('create-admin');
    expect((await run()).code).toBe(2);
  });

  it('stores a name with quotes and shell syntax verbatim', async () => {
    const name = `O'Neil "$(touch x)"`;
    await run('create-admin', '--email', 'quote@example.org', '--name', name);
    expect((await users.findByEmail('quote@example.org'))?.displayName).toBe(name);
  });
});
