import { parseArgs } from 'node:util';

export interface ParsedCommand {
  command: string | undefined;
  options: { email?: string; name?: string };
}

/** Splits `<command> --email <e> --name <n>`; throws a readable error for anything else. */
export function parseCommand(argv: readonly string[]): ParsedCommand {
  const { positionals, values } = parseArgs({
    args: [...argv],
    options: { email: { type: 'string' }, name: { type: 'string' } },
    allowPositionals: true,
  });
  const [command, ...stray] = positionals;
  if (stray.length > 0) throw new Error(`unexpected argument: ${stray.join(' ')}`);
  return { command, options: values };
}
