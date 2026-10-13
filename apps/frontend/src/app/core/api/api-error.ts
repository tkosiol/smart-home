import type { ApiErrorCode } from '@smart/contracts';

/** A failed `/api/` request, as the error interceptor hands it on. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}
