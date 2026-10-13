import { Logger } from '@nestjs/common';
import { normalizeEmail } from '@smart/contracts';
import type { SendMailOptions } from 'nodemailer';
import { maskEmail } from './mask-email.js';
import type { MailMessage, MailSender } from './mail-sender.js';

/** The part of a nodemailer transporter we use; lets tests pass a stub. */
export interface MailTransport {
  sendMail(options: SendMailOptions): Promise<unknown>;
}

export class SmtpMailSender implements MailSender {
  readonly enabled = true;
  private readonly logger = new Logger('Mail');

  /** `allowlist` holds normalized addresses; when set, all other recipients are dropped. */
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
    private readonly allowlist?: readonly string[],
  ) {}

  async send(message: MailMessage): Promise<void> {
    if (this.allowlist && !this.allowlist.includes(normalizeEmail(message.to))) {
      this.logger.warn(`Dropped mail to ${maskEmail(normalizeEmail(message.to))}: not allowlisted`);
      return;
    }
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
