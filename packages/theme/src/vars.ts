import { MaterialDynamicColors, hexFromArgb } from '@material/material-color-utilities';
import type { CoreColorId, ThemeColors } from '@smart/contracts';
import type { ResolvedAppearance } from './resolve.js';
import { COLOR_ROLES, toCamel } from './roles.js';
import { PALETTE_OF, buildScheme, sourceArgb } from './scheme.js';
import { fontVars, shapeVars } from './shape-font.js';
import { statusVars } from './status.js';

type RoleGetter = { getArgb(scheme: unknown): number };

export function computeThemeVars(resolved: ResolvedAppearance): Record<string, string> {
  const scheme = buildScheme(resolved.colors, resolved.mode, resolved.contrast);
  const vars: Record<string, string> = {};
  for (const role of COLOR_ROLES) {
    const getter = (MaterialDynamicColors as unknown as Record<string, RoleGetter>)[toCamel(role)]!;
    vars[`--mat-sys-${role}`] = hexFromArgb(getter.getArgb(scheme));
  }
  vars['--mat-sys-neutral10'] = hexFromArgb(scheme.neutralPalette.tone(10));
  vars['--mat-sys-neutral-variant20'] = hexFromArgb(scheme.neutralVariantPalette.tone(20));
  return {
    ...vars,
    ...statusVars(sourceArgb(resolved.colors), resolved.mode, resolved.contrast, {
      color: vars['--mat-sys-error']!,
      onColor: vars['--mat-sys-on-error']!,
      container: vars['--mat-sys-error-container']!,
      onContainer: vars['--mat-sys-on-error-container']!,
    }),
    ...shapeVars(resolved.shape),
    ...fontVars(resolved.font),
  };
}

/** Key colors as shown in the theme editor: the override, or the color derived from the current source. */
export function deriveKeyColors(
  colors: ThemeColors,
): Record<CoreColorId, { hex: string; source: 'derived' | 'override' }> {
  const scheme = buildScheme(colors, 'light', 'standard');
  const result = {} as Record<CoreColorId, { hex: string; source: 'derived' | 'override' }>;
  for (const id of Object.keys(PALETTE_OF) as CoreColorId[]) {
    const override = colors.coreOverrides[id];
    result[id] = override
      ? { hex: override.toLowerCase(), source: 'override' }
      : { hex: hexFromArgb(scheme[PALETTE_OF[id]].keyColor.toInt()), source: 'derived' };
  }
  return result;
}
