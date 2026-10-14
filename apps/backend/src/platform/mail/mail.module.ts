import { Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { ENV, type Env } from '../config/index.js';
import { DisabledMailSender, MAIL_SENDER, type MailSender } from './mail-sender.js';
import { SmtpMailSender } from './smtp-mail-sender.js';

@Module({
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [ENV],
      useFactory: (env: Env): MailSender =>
        env.SMTP_URL && env.MAIL_FROM
          ? new SmtpMailSender(createTransport(env.SMTP_URL), env.MAIL_FROM, env.MAIL_ALLOWLIST)
          : new DisabledMailSender(),
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule {}
