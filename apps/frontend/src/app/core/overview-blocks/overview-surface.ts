import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

/**
 * Which blocks the overview shows although the user hid them (`surfaceWhenHidden`, a critical
 * notice). The page cannot see that from outside the block, so a block reports it here; the page
 * then knows "everything hidden" is not the whole truth.
 */
@Injectable({ providedIn: 'root' })
export class OverviewSurface {
  private readonly ids = signal<ReadonlySet<string>>(new Set());

  /** Whether any block is on show against the user's choice. */
  readonly any = computed(() => this.ids().size > 0);

  set(id: string, surfaced: boolean): void {
    this.ids.update((ids) => {
      if (ids.has(id) === surfaced) return ids;
      const next = new Set(ids);
      if (surfaced) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}

/** For a block (in its injection context): tells the page while `surfaced()` is true. */
export function reportSurfaced(id: string, surfaced: () => boolean): void {
  const surface = inject(OverviewSurface);
  effect(() => surface.set(id, surfaced()));
  inject(DestroyRef).onDestroy(() => surface.set(id, false));
}
