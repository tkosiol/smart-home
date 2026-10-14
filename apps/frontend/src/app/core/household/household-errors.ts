import { inject } from '@angular/core';
import { ApiError, injectShowApiError } from '../api';
import { HouseholdContext } from './household-context';

/**
 * Handles a failed request on a household path: "household not found" (404) and "no permission
 * in this household" (403) mean membership or role changed, so the access is reloaded (the guards
 * then lead the user on); everything else is shown as a message, a 403 for another reason too
 * (`auth.forbidden`, `auth.badOrigin`). Call it in an injection context.
 */
export function injectHouseholdErrorHandler(): (error: unknown) => void {
  const household = inject(HouseholdContext);
  const showError = injectShowApiError();
  return (error) => {
    if (
      error instanceof ApiError &&
      (error.code === 'household.notFound' || error.code === 'household.forbidden')
    ) {
      void household.accessChanged();
    } else {
      showError(error);
    }
  };
}
