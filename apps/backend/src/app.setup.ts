import type { INestApplication } from '@nestjs/common';

/** Shared HTTP setup for main.ts and e2e tests, so both serve identical routes. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}
