import { NestFactory } from '@nestjs/core';
import { CliModule } from './cli.module.js';
import {
  CLOCK,
  type Clock,
  runCli,
  SessionsRepository,
  UsersRepository,
} from './core/identity/index.js';

// Administration commands (see docs/runbooks/provisioning.md); a context without an HTTP server
// and without MQTT (see CliModule).
const context = await NestFactory.createApplicationContext(CliModule, { logger: false });
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
