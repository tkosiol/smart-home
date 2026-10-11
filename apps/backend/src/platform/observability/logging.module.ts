import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from '../config/index.js';
import { createHttpLoggerOptions } from './http-logger.options.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ pinoHttp: createHttpLoggerOptions(env.LOG_LEVEL) }),
    }),
  ],
})
export class LoggingModule {}
