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
  /**
   * Live changes made while a load is on its way (an entry, or null for a removal, by id): the
   * answer was asked before them, so they are applied on top of it.
   */
  private readonly pending = new Map<string, T | null>();
  private loading = false;

  constructor(
    private readonly fetch: (householdId: string) => Promise<T[]>,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Ends the list's life: answers still on their way are ignored. */
  dispose(): void {
    this.requests++;
    this.loading = false;
    this.pending.clear();
  }

  private static idOf(item: unknown): unknown {
    return (item as { id?: unknown }).id;
  }

  /** Loads the list of `householdId` (none: empties it); `keep` leaves the old rows while loading. */
  async load(householdId: string | undefined, keep = false): Promise<void> {
    const request = ++this.requests;
    this.pending.clear();
    this.loading = false;
    if (!keep) {
      this.items.set([]);
      this.loaded.set(false);
    }
    if (!householdId) return;
    this.loading = true;
    try {
      const items = await this.fetch(householdId);
      if (request === this.requests) {
        this.items.set(this.withPending(items));
        this.loaded.set(true);
        this.loading = false;
        this.pending.clear();
      }
    } catch (error) {
      if (request === this.requests) {
        this.loading = false;
        this.pending.clear();
        this.onError(error);
      }
    }
  }

  private remember(id: string, item: T | null): void {
    if (!this.loading) return;
    this.pending.delete(id);
    this.pending.set(id, item);
  }

  private withPending(answer: readonly T[]): readonly T[] {
    let items = answer;
    for (const [id, item] of this.pending) {
      const rest = items.filter((other) => LoadedList.idOf(other) !== id);
      if (item === null) items = rest;
      else {
        const index = items.findIndex((other) => LoadedList.idOf(other) === id);
        items =
          index < 0 ? [...items, item] : items.map((other, i) => (i === index ? item : other));
      }
    }
    return items;
  }

  /** Replaces the entry with the same `id`, else appends; does nothing until the list is loaded. */
  upsert(item: T & { readonly id: string }): void {
    if (!this.loaded()) return;
    this.remember(item.id, item);
    this.items.update((items) => {
      const index = items.findIndex((other) => LoadedList.idOf(other) === item.id);
      return index < 0 ? [...items, item] : items.map((other, i) => (i === index ? item : other));
    });
  }

  /** Drops the entry with that `id`; does nothing until the list is loaded. */
  remove(id: string): void {
    if (!this.loaded()) return;
    this.remember(id, null);
    this.items.update((items) => items.filter((other) => LoadedList.idOf(other) !== id));
  }

  /** Sets the whole list as the server's answer (`loaded` true); answers still on their way are ignored. */
  replace(items: readonly T[]): void {
    this.requests++;
    this.loading = false;
    this.pending.clear();
    this.items.set(items);
    this.loaded.set(true);
  }
}
