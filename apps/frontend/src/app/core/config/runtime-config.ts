import { InjectionToken, type Provider } from '@angular/core';
import { DEFAULT_RUNTIME_CONFIG, parseRuntimeConfig, type RuntimeConfig } from '@smart/contracts';

export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_RUNTIME_CONFIG,
});

export function provideRuntimeConfig(config: RuntimeConfig): Provider {
  return { provide: RUNTIME_CONFIG, useValue: config };
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Fetches config.json (relative to <base href>) before the app starts. Any failure – missing,
 * not JSON, offline, slow – falls back to the defaults, because the app must start regardless.
 */
export async function loadRuntimeConfig(
  fetchFn: FetchFn = (input, init) => globalThis.fetch(input, init),
  timeoutMs = 3000,
): Promise<RuntimeConfig> {
  try {
    const response = await fetchFn('config.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return DEFAULT_RUNTIME_CONFIG;
    return parseRuntimeConfig(await response.json());
  } catch (error) {
    console.warn('config.json unavailable, using the defaults', error);
    return DEFAULT_RUNTIME_CONFIG;
  }
}
