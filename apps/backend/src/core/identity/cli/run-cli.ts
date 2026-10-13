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

const SAFE_WORD = /^[A-Za-z0-9_]{1,40}$/;

/**
 * Names the kind of an unexpected failure without leaking details: the class name and the
 * Postgres or system code (`23505`, `42P01`, `ECONNREFUSED`) of the error or its cause. Messages,
 * SQL and parameters can contain the e-mail address and are never printed.
 */
function describeFailure(error: unknown): string {
  let name = 'Error';
  let code: string | undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (SAFE_WORD.test(current.name)) name = current.name;
    const candidate = (current as { code?: unknown }).code;
    if (code === undefined && typeof candidate === 'string' && SAFE_WORD.test(candidate)) {
      code = candidate;
    }
    current = current.cause;
  }
  return code ? `${name} ${code}` : name;
}

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
    io.err(`create-admin failed: ${describeFailure(error)}`);
    return 1;
  }
}
