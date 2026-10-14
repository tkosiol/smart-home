import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@smart/contracts';

/** An error with a stable code the frontend translates; rendered by `ApiErrorFilter`. */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
    readonly params?: Record<string, string | number>,
  ) {
    super({ code, params }, status);
  }
}
