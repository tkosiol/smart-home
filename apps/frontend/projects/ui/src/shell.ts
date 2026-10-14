// Eager entry (@smart/ui/shell): only what startup code (app root, core/, shell/) imports.
// Add nothing that only lazy pages use: a file re-exported here is bundled with the shell, and
// the lint rule keeps startup code off the "@smart/ui" barrel for the same reason.
export {
  APPEARANCE_STORE,
  BOOT_CACHE_VERSION,
  LocalStorageAppearanceStore,
  type AppearanceKey,
  type AppearanceStore,
  type BootCache,
} from './lib/theme/appearance-store';
export { applyThemeVars } from './lib/theme/apply-theme';
export { INSTANCE_APPEARANCE } from './lib/theme/instance-appearance.token';
export { MEDIA_QUERIES, type MediaQueries } from './lib/theme/media-queries';
export { provideTheme, type ThemeOptions } from './lib/theme/provide-theme';
export { ThemeService } from './lib/theme/theme.service';
export { UiIcon, type UiIconSize } from './lib/icon/icon';
export { ICON_CODEPOINTS, type IconName } from './lib/icon/icon-codepoints';
export { UiButton, type UiButtonVariant } from './lib/button/button';
export { UiIconButton } from './lib/button/icon-button';
export { UiBanner, UiBannerActions, type UiBannerTone } from './lib/banner/banner';
export { UiBadge } from './lib/badge/badge';
export { UiTopAppBar, UiTopAppBarActions } from './lib/top-app-bar/top-app-bar';
export { UiAdaptiveShell, UiShellBanner, UiShellTopBar } from './lib/adaptive-shell/adaptive-shell';
export type { UiNavDestination, UiWindowClass } from './lib/adaptive-shell/navigation';
export { UiAnnouncer } from './lib/announcer/announcer';
export { UiSnackbar } from './lib/snackbar/snackbar';
export { UiFormatContext } from './lib/time/format-context';
export { loadUiTranslation } from './lib/i18n/ui-translations';
