import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inject } from 'vitest';
import { CliModule } from '../src/cli.module.js';
import {
  CLOCK,
  type Clock,
  runCli,
  SessionService,
  SessionsRepository,
  UsersRepository,
  type CliDeps,
  type CliOutput,
} from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

describe('revoke-sessions command', () => {
  let context: INestApplicationContext;
  let users: UsersRepository;
  let sessions: SessionService;
  let deps: CliDeps;
  let connection: DatabaseConnection;
  const originalUrl = inject('testEnv').DATABASE_URL;

  const run = async (...args: string[]): Promise<{ code: number; out: string; err: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliOutput = { out: (line) => out.push(line), err: (line) => err.push(line) };
    const code = await runCli(args, deps, io);
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const signIn = async (email: string): Promise<string> => {
    const user =
      (await users.findByEmail(email)) ?? (await users.create({ email, displayName: 'U' }));
    return (await sessions.create(user.id, 'email_code', 'Browser/1')).token;
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    context = await NestFactory.createApplicationContext(CliModule, { logger: false });
    users = context.get(UsersRepository);
    sessions = context.get(SessionService);
    deps = { users, sessions: context.get(SessionsRepository), clock: context.get<Clock>(CLOCK) };
    connection = context.get<DatabaseConnection>(DATABASE);
  });

  afterAll(async () => {
    await context.close();
    process.env.DATABASE_URL = originalUrl;
  });

  it('revokes every open session of the user and masks the address', async () => {
    const first = await signIn('Revoke.Me@Example.ORG');
    const second = await signIn('revoke.me@example.org');
    const other = await signIn('keeps@example.org');
    expect(await sessions.validate(first)).not.toBeNull();

    const result = await run('revoke-sessions', '--email', ' REVOKE.me@example.org ');

    expect(result.code).toBe(0);
    expect(result.out).toBe('revoked 2 sessions: r***@example.org');
    expect(result.out).not.toContain('Revoke.Me');
    expect(await sessions.validate(first)).toBeNull();
    expect(await sessions.validate(second)).toBeNull();
    expect(await sessions.validate(other)).not.toBeNull();
  });

  it('counts only sessions that were still open', async () => {
    await signIn('twice@example.org');
    expect((await run('revoke-sessions', '--email', 'twice@example.org')).out).toContain(
      'revoked 1 sessions',
    );
    const again = await run('revoke-sessions', '--email', 'twice@example.org');
    expect(again.code).toBe(0);
    expect(again.out).toContain('revoked 0 sessions');
    const [row] = await connection.sql`
      select count(*)::int as n from sessions s join users u on u.id = s.user_id
      where u.email = 'twice@example.org' and s.revoked_at is not null`;
    expect(row?.['n']).toBe(1);
  });

  it('exits 1 for an unknown e-mail without echoing the address', async () => {
    const result = await run('revoke-sessions', '--email', 'nobody@example.org');
    expect(result.code).toBe(1);
    expect(result.err).toContain('no such user');
    expect(`${result.out}${result.err}`).not.toContain('nobody@example.org');
  });

  it('exits 1 for a missing or invalid --email and 2 for an option it does not take', async () => {
    expect((await run('revoke-sessions')).code).toBe(1);
    expect((await run('revoke-sessions', '--email', 'not-an-email')).code).toBe(1);
    expect((await run('revoke-sessions', '--email', 'a@example.org', '--name', 'X')).code).toBe(2);
  });

  it('lists both commands in the usage', async () => {
    const result = await run('drop-database');
    expect(result.code).toBe(2);
    expect(result.err).toContain('create-admin');
    expect(result.err).toContain('revoke-sessions');
  });
});
