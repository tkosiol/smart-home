import { parseArgs } from 'node:util';

export interface ParsedCommand {
  command: string | undefined;
  options: { email?: string; name?: string };
}

/** The options each command takes; any other option is refused. */
const COMMAND_OPTIONS: Record<string, readonly string[]> = {
  'create-admin': ['email', 'name'],
  'revoke-sessions': ['email'],
};

/** Splits `<command> --email <e> [--name <n>]`; throws a readable error for anything else. */
export function parseCommand(argv: readonly string[]): ParsedCommand {
  const { positionals, values } = parseArgs({
    args: [...argv],
    options: { email: { type: 'string' }, name: { type: 'string' } },
    allowPositionals: true,
  });
  const [command, ...stray] = positionals;
  if (stray.length > 0) throw new Error(`unexpected argument: ${stray.join(' ')}`);
  const allowed = command === undefined ? undefined : COMMAND_OPTIONS[command];
  if (allowed) {
    const refused = Object.keys(values).find((option) => !allowed.includes(option));
    if (refused) throw new Error(`unknown option for ${command}: --${refused}`);
  }
  return { command, options: values };
}
