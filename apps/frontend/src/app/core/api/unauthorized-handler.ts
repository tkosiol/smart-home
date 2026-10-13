import { InjectionToken } from '@angular/core';

/** Called when the API says the session is missing or over (401 `auth.required`). Does nothing by default. */
export const UNAUTHORIZED_HANDLER = new InjectionToken<() => void>('UNAUTHORIZED_HANDLER', {
  providedIn: 'root',
  factory: () => () => undefined,
});
