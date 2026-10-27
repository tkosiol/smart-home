import { DestroyRef, computed, effect, inject, untracked, type Signal } from '@angular/core';
import type { AttentionItem } from '@smart/contracts';
import { injectLive } from '../../core/live';
import { RefreshGuard } from '../../core/refresh';
import { HouseholdContext, injectHouseholdErrorHandler, LoadedList } from '../../core/household';
import { AttentionApi, type DeviceSummary } from './attention.api';

export interface Attention {
  /** The open notices, most urgent first. */
  readonly items: Signal<readonly AttentionItem[]>;
  /** Whether `items` is the server's answer. */
  readonly loaded: Signal<boolean>;
  /** The device facts of the calm row; null until they are loaded (only asked for while calm). */
  readonly summary: Signal<DeviceSummary | null>;
}

/**
 * The notices of the current household: loaded when the context is created, again when the
 * household changes, and kept up to date by live events (after a reconnect it is loaded again; a
 * load that fails for lack of a connection keeps the old state quietly). While `wantSummary` is
 * true and nothing is open, the devices are asked for as well, for the calm row. Call it in an injection context.
 */
export function injectAttention(wantSummary: Signal<boolean>): Attention {
  const household = inject(HouseholdContext);
  const api = inject(AttentionApi);
  const handleError = injectHouseholdErrorHandler();
  const currentId = computed(() => household.current()?.id);
  const refresh = new RefreshGuard();
  const onError = refresh.quietNetworkFailure(handleError);

  const notices = new LoadedList<AttentionItem>((id) => api.list(id), onError);
  const devices = new LoadedList<DeviceSummary>(
    async (id) => [await api.deviceSummary(id)],
    onError,
  );
  inject(DestroyRef).onDestroy(() => {
    notices.dispose();
    devices.dispose();
  });

  effect(() => {
    const id = currentId();
    untracked(() => {
      void notices.load(id);
      // Only forgets the other household's devices; the calm row asks for the new ones itself.
      void devices.load(undefined);
    });
  });
  // Calm: look at the devices as often as at the notices (every load of the notices is a new list).
  effect(() => {
    const calm = notices.loaded() && notices.items().length === 0;
    const id = currentId();
    if (calm && wantSummary()) untracked(() => void devices.load(id, true));
  });
  injectLive({
    'attention.changed': ({ items }) => notices.replace(items),
    'device.state': ({ lastSeenAt }) => {
      const [current] = devices.items();
      if (!devices.loaded() || !current || lastSeenAt === null) return;
      if (current.lastSeenAt !== null && current.lastSeenAt >= lastSeenAt) return;
      devices.replace([{ ...current, lastSeenAt }]);
    },
    resync: () => void refresh.run(() => notices.load(currentId(), true)),
  });

  const summary = computed(() => (devices.loaded() ? (devices.items()[0] ?? null) : null));
  return { items: notices.items, loaded: notices.loaded, summary };
}
