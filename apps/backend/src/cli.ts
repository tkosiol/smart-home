import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  CLOCK,
  type Clock,
  runCli,
  SessionsRepository,
  UsersRepository,
} from './core/identity/index.js';

// Administration commands (see docs/runbooks/provisioning.md); a context without an HTTP server.
const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const deps = {
    users: context.get(UsersRepository),
    sessions: context.get(SessionsRepository),
    clock: context.get<Clock>(CLOCK),
  };
  process.exitCode = await runCli(process.argv.slice(2), deps, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
} finally {
  await context.close();
}
