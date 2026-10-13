import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../platform/http/index.js';
import { loginCode, MAIL_SENDER, maskEmail, type MailSender } from '../../platform/mail/index.js';
import { CLOCK, type Clock } from './clock.js';
import { EmailLoginRepository } from './email-login.repository.js';
import type { User } from './identity.schema.js';
import { newLoginCode, sameHash, sha256 } from './secrets.js';
import { SessionService } from './session.service.js';
import { UsersRepository } from './users.repository.js';

const MINUTE_MS = 60_000;
const CODE_VALID_MS = 10 * MINUTE_MS;
/** Per e-mail address: at most 3 codes in 15 minutes (spec 3.3). */
const REQUEST_LIMIT = { max: 3, windowMs: 15 * MINUTE_MS } as const;
export const MAX_ATTEMPTS = 5;

export interface SignedIn {
  user: User;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class EmailLoginService {
  private readonly logger = new Logger(EmailLoginService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly codes: EmailLoginRepository,
    private readonly sessions: SessionService,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `email` is normalized, `nonce` is the raw value of the browser's login-nonce cookie. */
  async request(email: string, nonce: string): Promise<void> {
    if (!this.mail.enabled) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'auth.mailDisabled');
    const user = await this.users.findByEmail(email);
    // Same response and comparable work for unknown addresses: no account enumeration (spec 3.3).
    const code = newLoginCode();
    if (!user) {
      sha256(code);
      sha256(nonce);
      return;
    }
    const now = this.clock();
    const result = await this.codes.replaceOpen(
      email,
      {
        codeHash: sha256(code),
        browserNonceHash: sha256(nonce),
        expiresAt: new Date(now.getTime() + CODE_VALID_MS),
      },
      { now, ...REQUEST_LIMIT },
    );
    if (!result.issued) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'auth.rateLimited', {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((result.retryAt.getTime() - now.getTime()) / 1000),
        ),
      });
    }
    // Not awaited: SMTP latency would otherwise reveal that the account exists. Failures are logged
    // without the error itself, which may quote the address.
    const deliver = async (): Promise<void> =>
      this.mail.send({ to: email, ...loginCode(user.locale, code) });
    void deliver().catch(() => {
      this.logger.error(`Login code mail to ${maskEmail(email)} failed`);
    });
  }

  /** `nonce` is undefined when the browser sent no (valid) login-nonce cookie. */
  async verify(
    email: string,
    code: string,
    nonce: string | undefined,
    userAgent: string,
  ): Promise<SignedIn> {
    const now = this.clock();
    const open = await this.codes.findOpen(email);
    if (!open || open.expiresAt <= now)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'auth.codeExpired');
    // A browser without the matching nonce is told the code is invalid but does not use up attempts.
    if (nonce === undefined || !sameHash(sha256(nonce), open.browserNonceHash)) {
      throw invalidCode(open.attempts);
    }
    if (open.attempts >= MAX_ATTEMPTS) throw tooManyAttempts();

    if (!sameHash(sha256(code), open.codeHash)) {
      const attempts = await this.codes.recordFailedAttempt(open.id, MAX_ATTEMPTS);
      if (attempts === undefined) throw tooManyAttempts();
      throw invalidCode(attempts);
    }

    const user = await this.users.findByEmail(email);
    if (!user || !(await this.codes.markUsed(open.id, now, MAX_ATTEMPTS))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'auth.codeExpired');
    }
    const session = await this.sessions.create(user.id, 'email_code', userAgent);
    return { user, ...session };
  }
}

const invalidCode = (attempts: number): ApiError =>
  new ApiError(HttpStatus.BAD_REQUEST, 'auth.invalidCode', {
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
  });

const tooManyAttempts = (): ApiError =>
  new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'auth.tooManyAttempts');
