import { InjectionToken } from '@angular/core';
import type { computeThemeVars } from '@smart/theme';

/** The part of the color engine the ThemeService needs; it pulls in the color library. */
export interface ThemeEngine {
  readonly computeThemeVars: typeof computeThemeVars;
}

/** Loads the color engine once, as its own chunk, so it stays out of the initial bundle. */
export async function loadThemeEngine(): Promise<ThemeEngine> {
  const { computeThemeVars } = await import('@smart/theme');
  return { computeThemeVars };
}

/** Replaceable in tests. */
export const THEME_ENGINE_LOADER = new InjectionToken<() => Promise<ThemeEngine>>(
  'THEME_ENGINE_LOADER',
  { providedIn: 'root', factory: () => loadThemeEngine },
);
