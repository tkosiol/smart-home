import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError, Public } from '../../platform/http/index.js';
import { SESSION_COOKIE } from './session.cookie.js';
import { SessionGuard } from './session.guard.js';
import type { SessionService } from './session.service.js';

class OpenController {
  @Public()
  open(): void {}

  closed(): void {}
}

const NOW = new Date('2026-01-01T00:00:00Z');
const EXPIRES = new Date('2026-01-31T00:00:00Z');

function setup(validate: SessionService['validate'] = () => Promise.resolve(null)) {
  const service = { validate } as SessionService;
  const guard = new SessionGuard(new Reflector(), service, () => NOW);
  const cookies: Record<string, string> = {};
  const request: Record<string, unknown> = { cookies };
  const setCookie = vi.fn();
  const context = (handler: () => void): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => OpenController,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ cookie: setCookie }),
      }),
    }) as unknown as ExecutionContext;
  return { guard, cookies, request, setCookie, context };
}

async function expectRequired(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  expect((error as ApiError).code).toBe('auth.required');
}

/** The decorated handler as Nest sees it (a method reference without its instance). */
const handlerOf = (name: 'open' | 'closed'): (() => void) =>
  Reflect.get<OpenController, 'open' | 'closed'>(OpenController.prototype, name);

describe('SessionGuard', () => {
  const controller = { open: handlerOf('open'), closed: handlerOf('closed') };

  it('lets @Public() routes through without looking at the cookie', async () => {
    const validate = vi.fn();
    const { guard, context } = setup(validate);
    await expect(guard.canActivate(context(controller.open))).resolves.toBe(true);
    expect(validate).not.toHaveBeenCalled();
  });

  it('rejects a missing cookie with 401 auth.required', async () => {
    const { guard, context } = setup();
    await expectRequired(guard.canActivate(context(controller.closed)));
  });

  it('rejects an unknown token with 401 auth.required', async () => {
    const { guard, cookies, context } = setup();
    cookies[SESSION_COOKIE] = 'unknown';
    await expectRequired(guard.canActivate(context(controller.closed)));
  });

  it('attaches the user and leaves the cookie alone when not refreshed', async () => {
    const { guard, cookies, request, setCookie, context } = setup(() =>
      Promise.resolve({ userId: 'u1', sessionId: 's1', refreshed: false, expiresAt: EXPIRES }),
    );
    cookies[SESSION_COOKIE] = 'token';
    await expect(guard.canActivate(context(controller.closed))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'u1', sessionId: 's1' });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('renews the cookie when the session was refreshed', async () => {
    const { guard, cookies, setCookie, context } = setup(() =>
      Promise.resolve({ userId: 'u1', sessionId: 's1', refreshed: true, expiresAt: EXPIRES }),
    );
    cookies[SESSION_COOKIE] = 'token';
    await guard.canActivate(context(controller.closed));
    expect(setCookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      'token',
      expect.objectContaining({ maxAge: EXPIRES.getTime() - NOW.getTime() }),
    );
  });

  it('ignores a non-string cookie value', async () => {
    const validate = vi.fn();
    const { guard, cookies, context } = setup(validate);
    (cookies as Record<string, unknown>)[SESSION_COOKIE] = { evil: true };
    await expectRequired(guard.canActivate(context(controller.closed)));
    expect(validate).not.toHaveBeenCalled();
  });
});
