const SAFE_WORD = /^[A-Za-z0-9_]{1,40}$/;
const FIRST_FRAME = '\n    at ';

/**
 * Names the kind of an unexpected failure without leaking details: the most specific class name
 * (some errors, like Drizzle's, keep `name` at `Error`) and the
 * Postgres or system code (`23505`, `42P01`, `ECONNREFUSED`) of the error or its cause. Messages,
 * SQL and parameters (a failed query quotes the e-mail address) are never included.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'non-Error value';
  let name = 'Error';
  let code: string | undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const label = [current.name, current.constructor.name].find(
      (word) => word !== 'Error' && SAFE_WORD.test(word),
    );
    if (label !== undefined) name = label;
    const candidate = (current as { code?: unknown }).code;
    if (code === undefined && typeof candidate === 'string' && SAFE_WORD.test(candidate)) {
      code = candidate;
    }
    current = current.cause;
  }
  return code ? `${name} ${code}` : name;
}

/** The stack frames only: everything from the first `    at ` line, never the message before it. */
export function stackFrames(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.stack === undefined) return undefined;
  const start = error.stack.indexOf(FIRST_FRAME);
  return start === -1 ? undefined : error.stack.slice(start + 1);
}
