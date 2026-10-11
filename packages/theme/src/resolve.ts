import type {
  InstanceAppearance,
  PersonalAppearance,
  ThemeColors,
  ThemeFont,
  ThemeShape,
} from '@smart/contracts';
import type { ResolvedContrast, ResolvedMode } from './scheme.js';

export interface SystemPreferences {
  prefersDark: boolean;
  prefersMoreContrast: boolean;
}

export interface ResolvedAppearance {
  colors: ThemeColors;
  shape: ThemeShape;
  font: ThemeFont;
  mode: ResolvedMode;
  contrast: ResolvedContrast;
}

/** Shape and font come from the instance; personal colors replace the instance colors as one unit. */
export function resolveAppearance(
  instance: InstanceAppearance,
  personal: PersonalAppearance,
  system: SystemPreferences,
): ResolvedAppearance {
  return {
    colors: personal.colors ?? instance.colors,
    shape: instance.shape,
    font: instance.font,
    mode: personal.mode === 'system' ? (system.prefersDark ? 'dark' : 'light') : personal.mode,
    contrast:
      personal.contrast === 'system'
        ? system.prefersMoreContrast
          ? 'high'
          : 'standard'
        : personal.contrast,
  };
}
