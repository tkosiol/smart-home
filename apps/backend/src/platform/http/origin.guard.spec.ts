import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/index.js';
import { ApiError } from './api-error.js';
import { OriginGuard } from './origin.guard.js';

const guard = new OriginGuard({ APP_ORIGIN: 'https://smart.example.org' } as Env);

function context(method: string, origin?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, headers: { origin } }) }),
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
});
