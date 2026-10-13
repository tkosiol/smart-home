import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { apiErrorSchema } from '@smart/contracts';
import { catchError, throwError } from 'rxjs';
import { ApiError } from './api-error';
import { UNAUTHORIZED_HANDLER } from './unauthorized-handler';

/**
 * Turns every failed `/api/` request into an `ApiError`. Bodies that do not follow the API error
 * format (a proxy page, a plain 404) count as `internal`. A 401 `auth.required` also calls the
 * unauthorized handler; the request still fails so that callers can end their loading state.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const unauthorized = inject(UNAUTHORIZED_HANDLER);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (!request.url.startsWith('/api/') || !(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }
      const parsed = apiErrorSchema.safeParse(error.error);
      const apiError = parsed.success
        ? new ApiError(parsed.data.code, error.status, parsed.data.params)
        : new ApiError('internal', error.status);
      if (error.status === 401 && apiError.code === 'auth.required') unauthorized();
      return throwError(() => apiError);
    }),
  );
};
