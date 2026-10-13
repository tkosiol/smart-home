import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MailModule } from '../../platform/mail/index.js';
import { AuthController } from './auth.controller.js';
import { CLOCK, type Clock } from './clock.js';
import { CleanupJob } from './cleanup.job.js';
import { EmailLoginRepository } from './email-login.repository.js';
import { EmailLoginService } from './email-login.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';
import { SessionsRepository } from './sessions.repository.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    { provide: CLOCK, useValue: ((): Date => new Date()) satisfies Clock },
    UsersRepository,
    SessionsRepository,
    SessionService,
    EmailLoginRepository,
    EmailLoginService,
    CleanupJob,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [CLOCK, UsersRepository, SessionService],
})
export class IdentityModule {}
