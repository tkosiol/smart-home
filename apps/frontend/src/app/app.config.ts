import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@smart/contracts';
import { provideTheme } from '@smart/ui';
import { routes } from './app.routes';
import { provideRuntimeConfig } from './core/config';
import { provideI18n } from './core/i18n';

export function createAppConfig(config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes),
      provideRuntimeConfig(config),
      provideI18n(),
      provideTheme({
        instance: config.instanceAppearance,
        allowStoredInstance: config.features.instanceAppearanceEditor,
      }),
    ],
  };
}
