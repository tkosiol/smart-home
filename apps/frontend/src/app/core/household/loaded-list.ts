import { signal } from '@angular/core';

/**
 * A list loaded for a household id; a slower answer to an older request never replaces a newer one.
 * (Not Angular's `resource`: using it from a lazy page enlarges the initial bundle.)
 */
export class LoadedList<T> {
  readonly items = signal<readonly T[]>([]);
  /** Whether `items` is the server's answer (not the empty list of a load that has not ended). */
  readonly loaded = signal(false);
  private requests = 0;

  constructor(
    private readonly fetch: (householdId: string) => Promise<T[]>,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Ends the list's life: answers still on their way are ignored. */
  dispose(): void {
    this.requests++;
  }

  /** Loads the list of `householdId` (none: empties it); `keep` leaves the old rows while loading. */
  async load(householdId: string | undefined, keep = false): Promise<void> {
    const request = ++this.requests;
    if (!keep) {
      this.items.set([]);
      this.loaded.set(false);
    }
    if (!householdId) return;
    try {
      const items = await this.fetch(householdId);
      if (request === this.requests) {
        this.items.set(items);
        this.loaded.set(true);
      }
    } catch (error) {
      if (request === this.requests) this.onError(error);
    }
  }

  /** Replaces the entry with the same `id`, else appends; does nothing until the list is loaded. */
  upsert(item: T & { readonly id: string }): void {
    if (!this.loaded()) return;
    this.items.update((items) => {
      const index = items.findIndex((other) => (other as { id?: unknown }).id === item.id);
      return index < 0 ? [...items, item] : items.map((other, i) => (i === index ? item : other));
    });
  }

  /** Drops the entry with that `id`; does nothing until the list is loaded. */
  remove(id: string): void {
    if (!this.loaded()) return;
    this.items.update((items) => items.filter((other) => (other as { id?: unknown }).id !== id));
  }

  /** Sets the whole list as the server's answer (`loaded` true); answers still on their way are ignored. */
  replace(items: readonly T[]): void {
    this.requests++;
    this.items.set(items);
    this.loaded.set(true);
  }
}
