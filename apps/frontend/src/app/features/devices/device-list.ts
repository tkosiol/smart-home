import { DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import type { Device } from '@smart/contracts';
import { HouseholdContext, injectHouseholdErrorHandler, LoadedList } from '../../core/household';
import { isNetworkFailure, refreshWhileVisible } from '../../core/refresh';
import { DevicesApi } from './devices.api';

/**
 * The devices of the current household: loaded when the context is created, again when the
 * household changes and every minute while the tab is visible (a refresh that fails for lack of a
 * connection keeps the old values quietly). Call it in an injection context.
 */
export function injectDeviceList(): LoadedList<Device> {
  const household = inject(HouseholdContext);
  const api = inject(DevicesApi);
  const handleError = injectHouseholdErrorHandler();
  const currentId = computed(() => household.current()?.id);
  let refreshing = false;
  const devices = new LoadedList<Device>(
    (id) => api.list(id),
    (error) => {
      if (!(refreshing && isNetworkFailure(error))) handleError(error);
    },
  );
  inject(DestroyRef).onDestroy(() => devices.dispose());
  // Keyed on the id, not on the household object.
  effect(() => {
    const id = currentId();
    untracked(() => void devices.load(id));
  });
  refreshWhileVisible(() => {
    refreshing = true;
    void devices.load(currentId(), true).finally(() => (refreshing = false));
  });
  return devices;
}
