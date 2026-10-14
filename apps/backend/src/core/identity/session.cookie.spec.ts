import type { Response } from 'express';
import {
  clearSessionCookie,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  setSessionCookie,
} from './session.cookie.js';

interface Recorded {
  call: 'cookie' | 'clearCookie';
  name: string;
  value?: string;
  options: Record<string, unknown>;
}

function fakeResponse(): { res: Response; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) =>
      calls.push({ call: 'cookie', name, value, options }),
    clearCookie: (name: string, options: Record<string, unknown>) =>
      calls.push({ call: 'clearCookie', name, options }),
  } as unknown as Response;
  return { res, calls };
}

describe('session cookie', () => {
  it('uses the __Host- prefix with HttpOnly, Secure, SameSite=Lax and Path=/, without Domain', () => {
    expect(SESSION_COOKIE).toBe('__Host-session');
    expect(SESSION_COOKIE_OPTIONS).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('sets the token with a maxAge (ms) up to expiresAt', () => {
    const { res, calls } = fakeResponse();
    const now = new Date('2026-01-01T00:00:00Z');
    setSessionCookie(res, 'token', new Date(now.getTime() + 30 * 86_400_000), now);
    expect(calls).toEqual([
      {
        call: 'cookie',
        name: SESSION_COOKIE,
        value: 'token',
        options: { ...SESSION_COOKIE_OPTIONS, maxAge: 30 * 86_400_000 },
      },
    ]);
  });

  it('never sets a negative maxAge', () => {
    const { res, calls } = fakeResponse();
    const now = new Date('2026-01-01T00:00:00Z');
    setSessionCookie(res, 'token', new Date(now.getTime() - 1000), now);
    expect(calls[0]?.options.maxAge).toBe(0);
  });

  it('clears the cookie with the same attributes', () => {
    const { res, calls } = fakeResponse();
    clearSessionCookie(res);
    expect(calls).toEqual([
      { call: 'clearCookie', name: SESSION_COOKIE, options: SESSION_COOKIE_OPTIONS },
    ]);
  });
});
