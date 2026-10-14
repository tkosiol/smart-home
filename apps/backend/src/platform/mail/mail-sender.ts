export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailSender {
  /** False when no SMTP server is configured; callers then must not offer mail-based flows. */
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');

/** Stands in when `SMTP_URL` is unset (self-hosting without mail). */
export class DisabledMailSender implements MailSender {
  readonly enabled = false;

  send(): Promise<void> {
    return Promise.reject(new Error('Mail is disabled: SMTP_URL is not configured'));
  }
}
