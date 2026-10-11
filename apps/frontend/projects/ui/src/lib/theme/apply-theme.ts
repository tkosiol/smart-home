import type { ResolvedMode } from '@smart/theme';

/** Writes theme variables via CSSOM, which the strict CSP allows (unlike inline style tags). */
export function applyThemeVars(
  root: HTMLElement,
  vars: Record<string, string>,
  mode: ResolvedMode,
): void {
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.style.colorScheme = mode;
}
