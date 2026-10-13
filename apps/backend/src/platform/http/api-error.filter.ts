import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError as ApiErrorBody } from '@smart/contracts';
import type { Request, Response } from 'express';
import { $ZodError } from 'zod/v4/core';
import { describeError, stackFrames } from '../errors/index.js';
import { ApiError } from './api-error.js';

/** A `BadRequestException` built from a message only (not from our own structured body). */
function isPlainBadRequest(exception: unknown): boolean {
  if (!(exception instanceof BadRequestException)) return false;
  const body = exception.getResponse();
  return typeof body === 'object' && 'error' in body && body.error === 'Bad Request';
}

/** The 4xx status of an http-errors style error (as thrown by Express body parsers), if any. */
function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' && value >= 400 && value <= 499 ? value : undefined;
}

/**
 * Renders every failure as `{ code, params, traceId }`. Other HttpExceptions keep the framework's
 * own response (404, the readiness 503 body); anything unknown becomes `500 internal`.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const traceId = String(http.getRequest<Request & { id?: string | number }>().id ?? 'unknown');

    if (exception instanceof ApiError) {
      this.send(response, exception.getStatus(), {
        code: exception.code,
        params: exception.params,
        traceId,
      });
    } else if (exception instanceof $ZodError) {
      // The issues name fields and may echo values; the client only learns that validation failed.
      this.send(response, HttpStatus.BAD_REQUEST, { code: 'validation.failed', traceId });
    } else if (isPlainBadRequest(exception)) {
      // Express maps malformed JSON bodies to a bare BadRequestException (message = parser text).
      this.send(response, HttpStatus.BAD_REQUEST, { code: 'validation.failed', traceId });
    } else if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
    } else if (clientErrorStatus(exception) !== undefined) {
      // Body-parser failures (malformed JSON, oversize body, ...) are the client's fault.
      this.send(response, clientErrorStatus(exception) ?? HttpStatus.BAD_REQUEST, {
        code: 'validation.failed',
        traceId,
      });
    } else {
      // The message of a failed query quotes its parameters (e-mail addresses), so only the kind of
      // error and the stack frames are logged.
      this.logger.error(
        `Unhandled error (traceId ${traceId}): ${describeError(exception)}`,
        stackFrames(exception),
      );
      this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, { code: 'internal', traceId });
    }
  }

  private send(response: Response, status: number, body: ApiErrorBody): void {
    response.status(status).json(body);
  }
}
