import { parseCommand } from './parse-args.js';

describe('parseCommand', () => {
  it('reads the command and its options', () => {
    expect(parseCommand(['create-admin', '--email', 'a@example.org', '--name', 'Anna B'])).toEqual({
      command: 'create-admin',
      options: { email: 'a@example.org', name: 'Anna B' },
    });
  });

  it('accepts --option=value and keeps quotes and shell syntax in values verbatim', () => {
    const name = `O'Neil "$(touch x)"`;
    expect(parseCommand(['create-admin', '--email=a@example.org', `--name=${name}`])).toEqual({
      command: 'create-admin',
      options: { email: 'a@example.org', name },
    });
  });

  it('has no command for an empty argument list', () => {
    expect(parseCommand([])).toEqual({ command: undefined, options: {} });
  });

  it('rejects unknown options and stray positionals', () => {
    expect(() => parseCommand(['create-admin', '--force'])).toThrow(/--force/);
    expect(() => parseCommand(['create-admin', 'extra'])).toThrow(/extra/);
  });
});
