import { describeError } from '../../../platform/errors/index.js';
import { maskEmail } from '../../../platform/mail/index.js';
import type { UsersRepository } from '../users.repository.js';
import { CliInputError, createAdmin } from './create-admin.js';
import { parseCommand } from './parse-args.js';

export interface CliOutput {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = 'usage: create-admin --email <address> --name <name>';

const OUTCOME_TEXT = {
  created: 'created platform admin',
  promoted: 'made existing user platform admin',
  unchanged: 'already platform admin, nothing changed',
} as const;

/** Runs one command; returns the exit code (0 ok, 1 invalid input or failure, 2 usage). */
export async function runCli(
  argv: readonly string[],
  users: UsersRepository,
  io: CliOutput,
): Promise<number> {
  let parsed;
  try {
    parsed = parseCommand(argv);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : 'invalid arguments'}\n${USAGE}`);
    return 2;
  }
  if (parsed.command !== 'create-admin') {
    io.err(USAGE);
    return 2;
  }
  try {
    const { outcome, email } = await createAdmin(users, parsed.options);
    io.out(`${OUTCOME_TEXT[outcome]}: ${maskEmail(email)}`);
    return 0;
  } catch (error) {
    if (error instanceof CliInputError) {
      io.err(`${error.message}\n${USAGE}`);
      return 1;
    }
    io.err(`create-admin failed: ${describeError(error)}`);
    return 1;
  }
}
