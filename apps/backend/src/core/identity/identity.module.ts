import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CLOCK, type Clock } from './clock.js';
import { CleanupJob } from './cleanup.job.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';
import { SessionsRepository } from './sessions.repository.js';
import { UsersRepository } from './users.repository.js';

@Module({
  providers: [
    { provide: CLOCK, useValue: ((): Date => new Date()) satisfies Clock },
    UsersRepository,
    SessionsRepository,
    SessionService,
    CleanupJob,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [CLOCK, UsersRepository, SessionService],
})
export class IdentityModule {}
