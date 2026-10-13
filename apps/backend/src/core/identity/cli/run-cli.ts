import { describeError } from '../../../platform/errors/index.js';
import { maskEmail } from '../../../platform/mail/index.js';
import type { Clock } from '../clock.js';
import type { SessionsRepository } from '../sessions.repository.js';
import type { UsersRepository } from '../users.repository.js';
import { CliInputError, createAdmin } from './create-admin.js';
import { parseCommand } from './parse-args.js';
import { revokeSessions } from './revoke-sessions.js';

export interface CliOutput {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface CliDeps {
  users: UsersRepository;
  sessions: SessionsRepository;
  clock: Clock;
}

const USAGE = [
  'usage: create-admin --email <address> --name <name>',
  '       revoke-sessions --email <address>',
].join('\n');

const OUTCOME_TEXT = {
  created: 'created platform admin',
  promoted: 'made existing user platform admin',
  unchanged: 'already platform admin, nothing changed',
} as const;

/** Runs one command; returns the exit code (0 ok, 1 invalid input or failure, 2 usage). */
export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
  io: CliOutput,
): Promise<number> {
  let parsed;
  try {
    parsed = parseCommand(argv);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : 'invalid arguments'}\n${USAGE}`);
    return 2;
  }
  const { command, options } = parsed;
  if (command !== 'create-admin' && command !== 'revoke-sessions') {
    io.err(USAGE);
    return 2;
  }
  try {
    if (command === 'create-admin') {
      const { outcome, email } = await createAdmin(deps.users, options);
      io.out(`${OUTCOME_TEXT[outcome]}: ${maskEmail(email)}`);
    } else {
      const { revoked, email } = await revokeSessions(deps, options);
      io.out(`revoked ${revoked} sessions: ${maskEmail(email)}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof CliInputError) {
      io.err(`${error.message}\n${USAGE}`);
      return 1;
    }
    io.err(`${command} failed: ${describeError(error)}`);
    return 1;
  }
}
