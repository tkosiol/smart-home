import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/index.js';
import { ApiError } from './api-error.js';
import { OriginGuard } from './origin.guard.js';
import { SkipOriginCheck } from './skip-origin-check.decorator.js';

const guard = new OriginGuard({ APP_ORIGIN: 'https://smart.example.org' } as Env, new Reflector());

class Routes {
  checked(this: void): void {
    return undefined;
  }

  @SkipOriginCheck()
  unchecked(this: void): void {
    return undefined;
  }
}

@SkipOriginCheck()
class UncheckedRoutes {
  any(this: void): void {
    return undefined;
  }
}

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
    try {
      guard.canActivate(context('POST', origin));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect((error as ApiError).code).toBe('auth.badOrigin');
    }
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'lets %s without an Origin through on a handler marked @SkipOriginCheck()',
    (method) => {
      expect(guard.canActivate(context(method, undefined, Routes.prototype.unchecked))).toBe(true);
      expect(
        guard.canActivate(context(method, 'https://evil.example.com', Routes.prototype.unchecked)),
      ).toBe(true);
    },
  );

  it('lets a request through on a controller marked @SkipOriginCheck()', () => {
    expect(
      guard.canActivate(context('POST', undefined, UncheckedRoutes.prototype.any, UncheckedRoutes)),
    ).toBe(true);
  });

  it('still checks the other handlers of the same controller', () => {
    expect(() => guard.canActivate(context('POST', undefined, Routes.prototype.checked))).toThrow(
      ApiError,
    );
  });
});
