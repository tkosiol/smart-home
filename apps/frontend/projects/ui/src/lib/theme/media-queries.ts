import { DestroyRef, InjectionToken, type Signal, inject, signal } from '@angular/core';

export interface MediaQueries {
  matches(query: string): boolean;
  listen(query: string, callback: (matches: boolean) => void): () => void;
}

class BrowserMediaQueries implements MediaQueries {
  matches(query: string): boolean {
    return globalThis.matchMedia?.(query).matches ?? false;
  }
  listen(query: string, callback: (matches: boolean) => void): () => void {
    const list = globalThis.matchMedia?.(query);
    if (!list) return () => undefined;
    const handler = (event: MediaQueryListEvent) => callback(event.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }
}

export const MEDIA_QUERIES = new InjectionToken<MediaQueries>('MEDIA_QUERIES', {
  providedIn: 'root',
  factory: () => new BrowserMediaQueries(),
});

/**
 * Whether `query` matches, as a signal that follows changes; call it in an injection context. The
 * listener ends with the caller's `DestroyRef`. Replaces the CDK's `BreakpointObserver`, which would
 * pull the CDK into the initial bundle.
 */
export function mediaQuerySignal(query: string): Signal<boolean> {
  const media = inject(MEDIA_QUERIES);
  const matches = signal(media.matches(query));
  const stop = media.listen(query, (value) => matches.set(value));
  inject(DestroyRef).onDestroy(stop);
  return matches.asReadonly();
}
