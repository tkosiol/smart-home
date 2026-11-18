import {
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import type { AttentionItem } from '@smart/contracts';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import { injectLive } from '../../core/live';
import { RefreshGuard } from '../../core/refresh';
import { DevicesApi } from './devices.api';

/**
 * What the server's attention items say about one device. The backend decides (with hysteresis)
 * when soil is dry or wet and a battery is low; the pod chip, the hero and the banner only follow.
 */
export interface DeviceNotices {
  readonly dry: boolean;
  readonly wet: boolean;
  readonly batteryLow: boolean;
}

export const NO_NOTICES: DeviceNotices = { dry: false, wet: false, batteryLow: false };

/** The notices per device id; a device without any is absent. */
export type NoticesByDevice = ReadonlyMap<string, DeviceNotices>;

/** Groups the attention items by device; only the kinds that show on a device count. */
export function noticesByDevice(items: readonly AttentionItem[]): NoticesByDevice {
  const result = new Map<string, DeviceNotices>();
  for (const item of items) {
    if (item.deviceId === undefined) continue;
    const before = result.get(item.deviceId) ?? NO_NOTICES;
    if (item.kind === 'soil_dry') result.set(item.deviceId, { ...before, dry: true });
    else if (item.kind === 'soil_wet') result.set(item.deviceId, { ...before, wet: true });
    else if (item.kind === 'battery_low') {
      result.set(item.deviceId, { ...before, batteryLow: true });
    }
  }
  return result;
}

/**
 * The attention items of the current household as notices per device: loaded with the household,
 * replaced by `attention.changed`, loaded again after a reconnect. (The devices feature loads them
 * itself: features do not import each other.) Call it in an injection context.
 */
export function injectDeviceNotices(): Signal<NoticesByDevice> {
  const household = inject(HouseholdContext);
  const api = inject(DevicesApi);
  const handleError = injectHouseholdErrorHandler();
  const currentId = computed(() => household.current()?.id);
  const refresh = new RefreshGuard();
  const quiet = refresh.quietNetworkFailure(handleError);
  const items = signal<readonly AttentionItem[]>([]);
  let requests = 0;
  inject(DestroyRef).onDestroy(() => requests++);

  async function load(householdId: string | undefined, keep = false): Promise<void> {
    const request = ++requests;
    if (!keep) items.set([]);
    if (!householdId) return;
    try {
      const answer = await api.attention(householdId);
      if (request === requests) items.set(answer);
    } catch (error) {
      if (request === requests) quiet(error);
    }
  }

  effect(() => {
    const id = currentId();
    untracked(() => void load(id));
  });
  injectLive({
    // The event carries the whole list; an answer asked before it is stale.
    'attention.changed': (list) => {
      requests++;
      items.set(list.items);
    },
    resync: () => void refresh.run(() => load(currentId(), true)),
  });
  return computed(() => noticesByDevice(items()));
}
