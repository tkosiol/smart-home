import {
  DynamicScheme,
  Hct,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
  argbFromHex,
} from '@material/material-color-utilities';
import type { CoreColorId, ThemeColors, ThemeVariant } from '@smart/contracts';

export type ResolvedMode = 'light' | 'dark';
export type ResolvedContrast = 'standard' | 'medium' | 'high';

export const CONTRAST_LEVEL: Record<ResolvedContrast, number> = {
  standard: 0,
  medium: 0.5,
  high: 1,
};

const SCHEMES: Record<
  ThemeVariant,
  new (source: Hct, isDark: boolean, contrastLevel: number) => DynamicScheme
> = {
  tonalSpot: SchemeTonalSpot,
  neutral: SchemeNeutral,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  fidelity: SchemeFidelity,
  content: SchemeContent,
  monochrome: SchemeMonochrome,
};

export const PALETTE_OF = {
  primary: 'primaryPalette',
  secondary: 'secondaryPalette',
  tertiary: 'tertiaryPalette',
  error: 'errorPalette',
  neutral: 'neutralPalette',
  neutralVariant: 'neutralVariantPalette',
} as const satisfies Record<CoreColorId, keyof DynamicScheme>;

/** Source color: a primary override acts as the source (Material Theme Builder behaviour). */
export function sourceArgb(colors: ThemeColors): number {
  return argbFromHex(colors.coreOverrides.primary ?? colors.seed);
}

export function buildScheme(
  colors: ThemeColors,
  mode: ResolvedMode,
  contrast: ResolvedContrast,
): DynamicScheme {
  const isDark = mode === 'dark';
  const level = CONTRAST_LEVEL[contrast];
  const source = sourceArgb(colors);
  const sourceHct = Hct.fromInt(source);
  const base = new SCHEMES[colors.variant](sourceHct, isDark, level);
  const overrides = colors.coreOverrides;
  if (!colors.colorMatch && Object.keys(overrides).length === 0) return base;

  // With colorMatch an override keeps its own chroma; otherwise only its hue is used.
  const palette = (id: CoreColorId, fallback: TonalPalette): TonalPalette => {
    const hex = overrides[id];
    if (!hex) return fallback;
    const argb = argbFromHex(hex);
    return colors.colorMatch
      ? TonalPalette.fromInt(argb)
      : TonalPalette.fromHueAndChroma(Hct.fromInt(argb).hue, fallback.chroma);
  };

  const scheme = new DynamicScheme({
    sourceColorArgb: source,
    // The library does not export the Variant enum; take Fidelity's value from a Fidelity scheme.
    variant: colors.colorMatch
      ? new SchemeFidelity(sourceHct, isDark, level).variant
      : base.variant,
    contrastLevel: level,
    isDark,
    primaryPalette: colors.colorMatch
      ? TonalPalette.fromInt(source)
      : palette('primary', base.primaryPalette),
    secondaryPalette: palette('secondary', base.secondaryPalette),
    tertiaryPalette: palette('tertiary', base.tertiaryPalette),
    neutralPalette: palette('neutral', base.neutralPalette),
    neutralVariantPalette: palette('neutralVariant', base.neutralVariantPalette),
  });
  if (overrides.error) {
    (scheme as unknown as { errorPalette: TonalPalette }).errorPalette = TonalPalette.fromInt(
      argbFromHex(overrides.error),
    );
  }
  return scheme;
}
