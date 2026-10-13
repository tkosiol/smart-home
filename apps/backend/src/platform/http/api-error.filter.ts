import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError as ApiErrorBody } from '@smart/contracts';
import type { Request, Response } from 'express';
import { $ZodError } from 'zod/v4/core';
import { ApiError } from './api-error.js';

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
    } else if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
    } else {
      this.logger.error(
        `Unhandled error (traceId ${traceId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, { code: 'internal', traceId });
    }
  }

  private send(response: Response, status: number, body: ApiErrorBody): void {
    response.status(status).json(body);
  }
}
