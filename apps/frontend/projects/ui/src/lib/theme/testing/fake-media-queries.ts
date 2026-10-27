import type { MediaQueries } from '../media-queries';

/** Media queries for tests and stories: `state` sets what matches, `emit` changes it live. */
export class FakeMediaQueries implements MediaQueries {
  readonly state: Record<string, boolean> = {};
  private readonly listeners: Record<string, Set<(matches: boolean) => void>> = {};

  constructor(initial: Record<string, boolean> = {}) {
    Object.assign(this.state, initial);
  }

  matches = (query: string) => this.state[query] ?? false;

  listen = (query: string, callback: (matches: boolean) => void) => {
    const set = (this.listeners[query] ??= new Set());
    set.add(callback);
    return () => void set.delete(callback);
  };

  emit(query: string, matches: boolean) {
    this.state[query] = matches;
    this.listeners[query]?.forEach((callback) => callback(matches));
  }

  listenerCount(query: string): number {
    return this.listeners[query]?.size ?? 0;
  }
}

/**
 * For stories: the given queries are fixed, every other one (colour scheme, reduced motion) is
 * answered by the browser.
 */
export function forcedMediaQueries(forced: Record<string, boolean>): MediaQueries {
  return {
    matches: (query) => forced[query] ?? globalThis.matchMedia?.(query).matches ?? false,
    listen: (query, callback) => {
      const list = query in forced ? undefined : globalThis.matchMedia?.(query);
      if (!list) return () => undefined;
      const handler = (event: MediaQueryListEvent) => callback(event.matches);
      list.addEventListener('change', handler);
      return () => list.removeEventListener('change', handler);
    },
  };
}
