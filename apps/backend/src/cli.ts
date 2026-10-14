import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { runCli, UsersRepository } from './core/identity/index.js';

// Administration commands (see docs/runbooks/provisioning.md); a context without an HTTP server.
const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  process.exitCode = await runCli(process.argv.slice(2), context.get(UsersRepository), {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
} finally {
  await context.close();
}
