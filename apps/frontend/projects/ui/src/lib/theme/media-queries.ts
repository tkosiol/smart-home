import { InjectionToken } from '@angular/core';

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
