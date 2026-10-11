import type { ThemeFont, ThemeShape } from '@smart/contracts';

const CORNERS: Record<ThemeShape, { xs: number; sm: number; md: number; lg: number; xl: number }> =
  {
    kantig: { xs: 2, sm: 4, md: 6, lg: 10, xl: 16 },
    standard: { xs: 4, sm: 8, md: 12, lg: 16, xl: 28 },
    weich: { xs: 6, sm: 12, md: 18, lg: 26, xl: 36 },
  };

export const FONT_FAMILIES: Record<ThemeFont, string> = {
  'roboto-flex': "'Roboto Flex Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
  figtree: "'Figtree Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
  atkinson:
    "'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export function shapeVars(shape: ThemeShape): Record<string, string> {
  const c = CORNERS[shape];
  return {
    '--mat-sys-corner-none': '0',
    '--mat-sys-corner-extra-small': `${c.xs}px`,
    '--mat-sys-corner-extra-small-top': `${c.xs}px ${c.xs}px 0 0`,
    '--mat-sys-corner-small': `${c.sm}px`,
    '--mat-sys-corner-medium': `${c.md}px`,
    '--mat-sys-corner-large': `${c.lg}px`,
    '--mat-sys-corner-large-top': `${c.lg}px ${c.lg}px 0 0`,
    '--mat-sys-corner-large-start': `${c.lg}px 0 0 ${c.lg}px`,
    '--mat-sys-corner-large-end': `0 ${c.lg}px ${c.lg}px 0`,
    '--mat-sys-corner-extra-large': `${c.xl}px`,
    '--mat-sys-corner-extra-large-top': `${c.xl}px ${c.xl}px 0 0`,
    '--mat-sys-corner-full': '9999px',
  };
}

export function fontVars(font: ThemeFont): Record<string, string> {
  return { '--smart-font-family': FONT_FAMILIES[font] };
}
