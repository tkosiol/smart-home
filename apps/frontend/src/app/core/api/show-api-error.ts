import { inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import type { ApiErrorCode } from '@smart/contracts';
import { UiSnackbar } from '@smart/ui';
import { ApiError } from './api-error';

/** One text per error code; `marker` keeps the keys for the key check, the lookup below is dynamic. */
const ERROR_TEXT_KEYS: Record<ApiErrorCode, string> = {
  'auth.required': marker('app.errors.auth.required'),
  'auth.badOrigin': marker('app.errors.auth.badOrigin'),
  'auth.invalidCode': marker('app.errors.auth.invalidCode'),
  'auth.tooManyAttempts': marker('app.errors.auth.tooManyAttempts'),
  'auth.rateLimited': marker('app.errors.auth.rateLimited'),
  'auth.mailDisabled': marker('app.errors.auth.mailDisabled'),
  'validation.failed': marker('app.errors.validation.failed'),
  internal: marker('app.errors.internal'),
};

/**
 * Returns a function that shows an error as a snackbar with the translated text of its code.
 * Anything that is not an `ApiError` shows the `internal` text. Call it in an injection context.
 */
export function injectShowApiError(): (error: unknown) => void {
  const transloco = inject(TranslocoService);
  const snackbar = inject(UiSnackbar);
  return (error) => {
    const { code, params } =
      error instanceof ApiError ? error : { code: 'internal' as const, params: undefined };
    void snackbar.show(transloco.translate(ERROR_TEXT_KEYS[code], params), {
      politeness: 'assertive',
    });
  };
}
