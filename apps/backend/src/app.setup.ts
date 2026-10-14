import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { ENV, type Env } from './platform/config/index.js';
import { noStore } from './platform/http/index.js';

/** Shared HTTP setup for main.ts and e2e tests, so both serve identical routes. */
export function configureApp(app: INestApplication): void {
  // A number (not `true`): only the last N X-Forwarded-For entries are trusted, so a client cannot
  // choose its own IP for the rate limits.
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', app.get<Env>(ENV).TRUSTED_PROXY_HOPS);
  app.setGlobalPrefix('api');
  app.use('/api', noStore);
  app.use(cookieParser());
  app.enableShutdownHooks();
}
