import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@smart/contracts';
import { provideTheme } from '@smart/ui';
import { routes } from './app.routes';
import { provideRuntimeConfig } from './core/config';
import { provideI18n } from './core/i18n';
import { PageTitleStrategy } from './core/routing';
import { provideSettingsFeature } from './features/settings';

export function createAppConfig(config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
      { provide: TitleStrategy, useExisting: PageTitleStrategy },
      provideRuntimeConfig(config),
      provideI18n(),
      provideSettingsFeature(),
      provideServiceWorker('ngsw-worker.js', {
        enabled: !isDevMode(),
        registrationStrategy: 'registerWhenStable:30000',
      }),
      provideTheme({
        instance: config.instanceAppearance,
        allowStoredInstance: config.features.instanceAppearanceEditor,
      }),
    ],
  };
}
