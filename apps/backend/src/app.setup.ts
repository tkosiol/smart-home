import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { noStore } from './platform/http/index.js';

/** Shared HTTP setup for main.ts and e2e tests, so both serve identical routes. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.use('/api', noStore);
  app.use(cookieParser());
  app.enableShutdownHooks();
}
