/** The roles the chart paints with, read from the theme's CSS custom properties (spec 4.1). */
export interface ChartColors {
  readonly primary: string;
  readonly outline: string;
  readonly outlineVariant: string;
  readonly onSurfaceVariant: string;
  /** Colour of the card the chart sits on: halos, rings and the dot's edge. */
  readonly card: string;
  readonly dry: string;
  readonly dryContainer: string;
  readonly fontFamily: string;
  readonly dark: boolean;
}

/**
 * Opacity of the washes per colour scheme (the approved design); the roles stay, only their
 * strength differs: the dark scheme needs stronger hairlines on its darker card.
 */
export function chartAlphas(dark: boolean) {
  return dark
    ? { area: 0.26, ribbon: 0.22, band: 0.5, grid: 0.7, threshold: 0.6, pointer: 0.7 }
    : { area: 0.2, ribbon: 0.16, band: 0.42, grid: 0.55, threshold: 0.55, pointer: 0.7 };
}

/** Reads the roles at `host`; a missing property falls back to the text colour. */
export function readChartColors(host: Element, dark: boolean): ChartColors {
  const style = getComputedStyle(host);
  const read = (name: string) => style.getPropertyValue(name).trim() || 'currentColor';
  return {
    primary: read('--mat-sys-primary'),
    outline: read('--mat-sys-outline'),
    outlineVariant: read('--mat-sys-outline-variant'),
    onSurfaceVariant: read('--mat-sys-on-surface-variant'),
    card: read('--mat-sys-surface-container-low'),
    dry: read('--smart-status-dry'),
    dryContainer: read('--smart-status-dry-container'),
    fontFamily: style.fontFamily || 'sans-serif',
    dark,
  };
}

/**
 * `color` with the given opacity as `rgba(...)`. ECharts cannot parse `color-mix()`, so the
 * role colour (`#rgb`, `#rrggbb`, `rgb()`) is converted; any other notation is returned as is.
 */
export function withAlpha(color: string, alpha: number): string {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})` : value;
}
