import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTheme } from '@smart/ui';
import { routes } from './app.routes';
import { provideI18n } from './core/i18n';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideI18n(),
    provideTheme(),
  ],
};
