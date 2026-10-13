import { inject } from '@angular/core';
import { ApiError, injectShowApiError } from '../../core/api';
import { HouseholdContext } from '../../core/household';

/**
 * Handles a failed request on a household path: 403/404 mean membership or role changed, so the
 * access is reloaded (the guards then lead the user on); everything else is shown as a message.
 * Call it in an injection context.
 */
export function injectHouseholdErrorHandler(): (error: unknown) => void {
  const household = inject(HouseholdContext);
  const showError = injectShowApiError();
  return (error) => {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      void household.accessChanged();
    } else {
      showError(error);
    }
  };
}
