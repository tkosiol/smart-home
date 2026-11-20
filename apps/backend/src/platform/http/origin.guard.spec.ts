import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/index.js';
import { ApiError } from './api-error.js';
import { OriginGuard } from './origin.guard.js';
import { Public } from './public.decorator.js';
import { SkipOriginCheck } from './skip-origin-check.decorator.js';

const guard = new OriginGuard({ APP_ORIGIN: 'https://smart.example.org' } as Env, new Reflector());

class Routes {
  checked(this: void): void {
    return undefined;
  }

  @Public()
  @SkipOriginCheck()
  unchecked(this: void): void {
    return undefined;
  }

  /** Marked, but behind a session: the marker must not switch the check off. */
  @SkipOriginCheck()
  withSession(this: void): void {
    return undefined;
  }
}

@Public()
class PublicRoutes {
  @SkipOriginCheck()
  unchecked(this: void): void {
    return undefined;
  }
}

const expectBadOrigin = (run: () => unknown): void => {
  try {
    run();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect((error as ApiError).code).toBe('auth.badOrigin');
  }
};

function context(
  method: string,
  origin?: string,
  handler: () => void = Routes.prototype.checked,
  controller: object = Routes,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, headers: { origin } }) }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

describe('OriginGuard', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s without an Origin through', (method) => {
    expect(guard.canActivate(context(method))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('accepts %s with the exact Origin', (method) => {
    expect(guard.canActivate(context(method, 'https://smart.example.org'))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s without an Origin', (method) => {
    expect(() => guard.canActivate(context(method))).toThrowError(ApiError);
  });

  it.each([
    'https://evil.example.com',
    'https://smart.example.org.evil.example.com',
    'http://smart.example.org',
    'https://smart.example.org/',
    'null',
  ])('rejects POST from %s with 403 auth.badOrigin', (origin) => {
    expectBadOrigin(() => guard.canActivate(context('POST', origin)));
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'lets %s without an Origin through on a public handler marked @SkipOriginCheck()',
    (method) => {
      expect(guard.canActivate(context(method, undefined, Routes.prototype.unchecked))).toBe(true);
      expect(
        guard.canActivate(context(method, 'https://evil.example.com', Routes.prototype.unchecked)),
      ).toBe(true);
    },
  );

  it('lets a handler marked @SkipOriginCheck() of a public controller through', () => {
    expect(
      guard.canActivate(context('POST', undefined, PublicRoutes.prototype.unchecked, PublicRoutes)),
    ).toBe(true);
  });

  it('checks a handler marked @SkipOriginCheck() that is not public: 403 auth.badOrigin', () => {
    expectBadOrigin(() =>
      guard.canActivate(context('POST', undefined, Routes.prototype.withSession)),
    );
    expectBadOrigin(() =>
      guard.canActivate(context('POST', 'https://evil.example.com', Routes.prototype.withSession)),
    );
  });

  it('still checks the other handlers of the same controller', () => {
    expect(() => guard.canActivate(context('POST', undefined, Routes.prototype.checked))).toThrow(
      ApiError,
    );
  });
});
