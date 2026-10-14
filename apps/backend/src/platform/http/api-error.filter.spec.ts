import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { apiErrorSchema } from '@smart/contracts';
import { DrizzleQueryError } from 'drizzle-orm/errors';
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

  it('turns a message-only BadRequestException (malformed JSON) into validation.failed', () => {
    const { status, body } = run(new BadRequestException('Unexpected token \'b\' in {"secret"'));
    expect(status).toBe(400);
    expect(apiErrorSchema.parse(body)).toEqual({ code: 'validation.failed', traceId: 'trace-123' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it.each([
    [400, 'entity.parse.failed'],
    [413, 'entity.too.large'],
    [415, 'charset.unsupported'],
  ])('keeps the %i status of body-parser client errors as validation.failed', (status, type) => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const clientError = Object.assign(new Error('Unexpected token in JSON'), {
      status,
      statusCode: status,
      type,
    });
    const result = run(clientError);
    expect(result.status).toBe(status);
    expect(apiErrorSchema.parse(result.body)).toEqual({
      code: 'validation.failed',
      traceId: 'trace-123',
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('does not mistake a 5xx status on a foreign error for a client error', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(run(Object.assign(new Error('x'), { status: 502 })).status).toBe(500);
  });

  it('answers unknown errors with 500 internal without exposing the message', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('db password is hunter2'));
    expect(status).toBe(500);
    expect(apiErrorSchema.parse(body)).toEqual({ code: 'internal', traceId: 'trace-123' });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('logs class, code, trace id and stack frames of a failed query, never message or params', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const cause = Object.assign(new Error('terminating connection for till@example.org'), {
      code: '57P01',
    });
    const failure = new DrizzleQueryError(
      'select "id" from "users" where "users"."email" = $1',
      ['till@example.org'],
      cause,
    );
    run(failure);
    const logged = error.mock.calls.flat().map(String).join('\n');
    expect(logged).toContain('DrizzleQueryError');
    expect(logged).toContain('57P01');
    expect(logged).toContain('trace-123');
    expect(logged).toContain('    at ');
    expect(logged).not.toContain('till@example.org');
    expect(logged).not.toContain('Failed query');
    expect(logged).not.toContain('params');
    expect(logged).not.toContain('terminating connection');
  });

  it('logs a thrown non-Error without its value', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(run('till@example.org').status).toBe(500);
    expect(error.mock.calls.flat().map(String).join('\n')).not.toContain('till@example.org');
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
