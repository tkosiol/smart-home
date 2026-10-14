import type { CookieOptions, Response } from 'express';

/** `__Host-` requires Secure, Path=/ and no Domain; localhost counts as a secure context. */
export const SESSION_COOKIE = '__Host-session';

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const satisfies CookieOptions;

/** The cookie lives exactly as long as the session; `now` is injectable for tests. */
export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  now: Date = new Date(),
): void {
  res.cookie(SESSION_COOKIE, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
}
