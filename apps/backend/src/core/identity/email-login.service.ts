import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../platform/http/index.js';
import { loginCode, MAIL_SENDER, maskEmail, type MailSender } from '../../platform/mail/index.js';
import { CLOCK, type Clock } from './clock.js';
import { EmailLoginRepository } from './email-login.repository.js';
import { HitLimiter } from './hit-limiter.js';
import type { User } from './identity.schema.js';
import { newLoginCode, sameHash, sha256 } from './secrets.js';
import { SessionService } from './session.service.js';
import { UsersRepository } from './users.repository.js';

const MINUTE_MS = 60_000;
const CODE_VALID_MS = 10 * MINUTE_MS;
const WINDOW_MS = 15 * MINUTE_MS;
/** Per e-mail address: at most 3 codes in 15 minutes (spec 3.3). */
const MAX_REQUESTS = 3;
export const MAX_ATTEMPTS = 5;

export interface SignedIn {
  user: User;
  token: string;
  expiresAt: Date;
}

/**
 * Both limits are counted in memory by hashed keys and apply to every address, known or not, so a
 * 429 never reveals whether an account exists. (One backend instance; a restart resets them.)
 */
@Injectable()
export class EmailLoginService {
  private readonly logger = new Logger(EmailLoginService.name);
  private readonly requests = new HitLimiter(MAX_REQUESTS, WINDOW_MS);
  /** Verification tries per address and browser, reserved before the code is checked. */
  private readonly attempts = new HitLimiter(MAX_ATTEMPTS, WINDOW_MS);

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
    const now = this.clock();
    const limit = this.requests.hit(sha256(email), now);
    if (!limit.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'auth.rateLimited', {
        retryAfterSeconds: Math.max(1, Math.ceil((limit.retryAt.getTime() - now.getTime()) / 1000)),
      });
    }
    // A fresh code starts a fresh set of tries for this browser, whether or not the address exists.
    this.attempts.clear(attemptKey(email, nonce));

    const user = await this.users.findByEmail(email);
    // Same response and comparable work for unknown addresses: no account enumeration (spec 3.3).
    const code = newLoginCode();
    if (!user) {
      sha256(code);
      sha256(nonce);
      return;
    }
    await this.codes.replaceOpen(
      email,
      {
        codeHash: sha256(code),
        browserNonceHash: sha256(nonce),
        expiresAt: new Date(now.getTime() + CODE_VALID_MS),
      },
      now,
    );
    // Not awaited: SMTP latency would otherwise reveal that the account exists. Failures are logged
    // without the error itself, which may quote the address.
    const deliver = async (): Promise<void> =>
      this.mail.send({ to: email, ...loginCode(user.locale, code) });
    void deliver().catch(() => {
      this.logger.error(`Login code mail to ${maskEmail(email)} failed`);
    });
  }

  /**
   * `nonce` is undefined when the browser sent no (valid) login-nonce cookie. Every failure (no
   * code, expired, used, wrong browser, wrong code) is the same `auth.invalidCode`; after 5 tries
   * per address and browser it is `auth.tooManyAttempts`, also for addresses without an account.
   */
  async verify(
    email: string,
    code: string,
    nonce: string | undefined,
    userAgent: string,
  ): Promise<SignedIn> {
    const now = this.clock();
    const key = attemptKey(email, nonce);
    if (!this.attempts.hit(key, now).allowed) throw tooManyAttempts();

    const open = await this.codes.findOpen(email);
    // A wrong browser only uses up the in-memory tries, never the attempts of the code's owner.
    if (
      !open ||
      open.expiresAt <= now ||
      nonce === undefined ||
      !sameHash(sha256(nonce), open.browserNonceHash)
    ) {
      throw invalidCode();
    }
    if (open.attempts >= MAX_ATTEMPTS) throw tooManyAttempts();

    if (!sameHash(sha256(code), open.codeHash)) {
      const attempts = await this.codes.recordFailedAttempt(open.id, MAX_ATTEMPTS);
      throw attempts === undefined ? tooManyAttempts() : invalidCode();
    }

    const user = await this.users.findByEmail(email);
    if (!user || !(await this.codes.markUsed(open.id, now, MAX_ATTEMPTS))) throw invalidCode();
    this.attempts.clear(key);
    // The first proof of the mailbox ends sessions anyone else got through an invitation link: the
    // inviter sees that link too (spec 3.7) and may have created this account in his own browser.
    // Done before the new session exists, so that one is never touched.
    await this.sessions.revokeByMethod(user.id, 'invitation');
    const session = await this.sessions.create(user.id, 'email_code', userAgent);
    return { user, ...session };
  }
}

const attemptKey = (email: string, nonce: string | undefined): string =>
  `${sha256(email)}:${sha256(nonce ?? '')}`;

const invalidCode = (): ApiError => new ApiError(HttpStatus.BAD_REQUEST, 'auth.invalidCode');

const tooManyAttempts = (): ApiError =>
  new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'auth.tooManyAttempts');
