import type { Response } from 'express';
import { SESSION_COOKIE_OPTIONS } from './session.cookie.js';

/** Binds an e-mail code to the browser that asked for it (spec 3.3). */
export const LOGIN_NONCE_COOKIE = '__Host-login-nonce';
export const LOGIN_NONCE_MAX_AGE_MS = 15 * 60_000;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The nonce of a request cookie, or undefined when it is missing or malformed. */
export function readNonce(cookie: unknown): string | undefined {
  return typeof cookie === 'string' && NONCE_PATTERN.test(cookie) ? cookie : undefined;
}

export function setLoginNonceCookie(res: Response, nonce: string): void {
  res.cookie(LOGIN_NONCE_COOKIE, nonce, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: LOGIN_NONCE_MAX_AGE_MS,
  });
}

export function clearLoginNonceCookie(res: Response): void {
  res.clearCookie(LOGIN_NONCE_COOKIE, SESSION_COOKIE_OPTIONS);
}
