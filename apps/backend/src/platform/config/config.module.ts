import { Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env.schema.js';
import { ENV } from './env.token.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
