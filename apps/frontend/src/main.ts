import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { createAppConfig } from './app/app.config';
import { loadRuntimeConfig } from './app/core/config';

loadRuntimeConfig()
  .then((config) => bootstrapApplication(App, createAppConfig(config)))
  .catch((err) => console.error(err));
