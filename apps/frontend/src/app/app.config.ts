import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@smart/contracts';
import { provideTheme } from '@smart/ui/shell';
import { routes } from './app.routes';
import { provideAuth } from './core/auth';
import { provideRuntimeConfig } from './core/config';
import { provideI18n } from './core/i18n';
import { provideInstanceAppearance } from './core/instance';
import { PageTitleStrategy } from './core/routing';
import { provideHouseholdsFeature } from './features/households';
import { provideSettingsFeature } from './features/settings';

export function createAppConfig(config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
      { provide: TitleStrategy, useExisting: PageTitleStrategy },
      provideRuntimeConfig(config),
      provideAuth(),
      provideInstanceAppearance(),
      provideI18n(),
      provideHouseholdsFeature(),
      provideSettingsFeature(),
      provideServiceWorker('ngsw-worker.js', {
        enabled: !isDevMode(),
        registrationStrategy: 'registerWhenStable:30000',
      }),
      provideTheme({ instance: config.instanceAppearance }),
    ],
  };
}
