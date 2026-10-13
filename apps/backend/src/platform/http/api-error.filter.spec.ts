import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { apiErrorSchema } from '@smart/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import { ApiError } from './api-error.js';
import { ApiErrorFilter } from './api-error.filter.js';

function run(exception: unknown): { status: number; body: unknown } {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const request = { id: 'trace-123' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  new ApiErrorFilter().catch(exception, host);
  return {
    status: response.status.mock.calls[0]?.[0] as number,
    body: response.json.mock.calls[0]?.[0],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('ApiErrorFilter', () => {
  it('renders an ApiError as { code, params, traceId } with its status', () => {
    const { status, body } = run(
      new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'auth.rateLimited', { retryAfterSeconds: 30 }),
    );
    expect(status).toBe(429);
    expect(apiErrorSchema.parse(body)).toEqual({
      code: 'auth.rateLimited',
      params: { retryAfterSeconds: 30 },
      traceId: 'trace-123',
    });
  });

  it('omits params when the error has none', () => {
    const { body } = run(new ApiError(HttpStatus.FORBIDDEN, 'auth.badOrigin'));
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      code: 'auth.badOrigin',
      traceId: 'trace-123',
    });
  });

  it('maps a Zod validation error to 400 validation.failed without field values', () => {
    const result = z.object({ email: z.email() }).safeParse({ email: 'leaked-secret-value' });
    const { status, body } = run(result.error);
    expect(status).toBe(400);
    expect(apiErrorSchema.parse(body)).toEqual({ code: 'validation.failed', traceId: 'trace-123' });
    expect(JSON.stringify(body)).not.toContain('leaked-secret-value');
  });

  it('also maps errors thrown by the zod/mini schemas of @smart/contracts', () => {
    const result = zm.object({ code: zm.string() }).safeParse({ code: 1 });
    expect(run(result.error)).toMatchObject({ status: 400, body: { code: 'validation.failed' } });
  });

  it('answers unknown errors with 500 internal and logs the stack, not the message body', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const boom = new Error('db password is hunter2');
    const { status, body } = run(boom);
    expect(status).toBe(500);
    expect(apiErrorSchema.parse(body)).toEqual({ code: 'internal', traceId: 'trace-123' });
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('trace-123'), boom.stack);
  });

  it('keeps the framework response of other HttpExceptions (404, health 503 body)', () => {
    expect(run(new NotFoundException())).toMatchObject({
      status: 404,
      body: { statusCode: 404, message: 'Not Found' },
    });
    expect(run(new BadRequestException({ any: 'thing' }))).toEqual({
      status: 400,
      body: { any: 'thing' },
    });
  });
});
