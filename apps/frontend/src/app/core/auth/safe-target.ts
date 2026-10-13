/** Where the sign-in page leads when the `ziel` query parameter is missing or not acceptable. */
const HOME = '/';
/** The sign-in page itself is never a target: it would send a signed-in user round in circles. */
const SIGN_IN_PATH = '/anmelden';

/**
 * Returns `target` when it is a path inside this app and `/` otherwise (open-redirect protection):
 * a single leading slash, no `//`, no scheme, no backslash and no whitespace or control character
 * (browsers drop tabs and line breaks from URLs, so `/\t/evil.example` would become `//evil.example`).
 */
export function safeTarget(target: string | null | undefined): string {
  if (typeof target !== 'string') return HOME;
  if (!target.startsWith('/') || target.startsWith('//')) return HOME;
  if (hasForbiddenCharacter(target)) return HOME;
  const path = target.split(/[?#]/, 1)[0];
  if (path === SIGN_IN_PATH || path.startsWith(`${SIGN_IN_PATH}/`)) return HOME;
  return target;
}

function hasForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const control = code <= 0x20 || (code >= 0x7f && code <= 0x9f);
    if (control || character === '\\' || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}
