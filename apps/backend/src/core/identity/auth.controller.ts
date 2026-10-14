import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { emailCodeRequestSchema, emailCodeVerifySchema, type Me } from '@smart/contracts';
import type { Request, Response } from 'express';
import { Public, RateLimit } from '../../platform/http/index.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { CLOCK, type Clock } from './clock.js';
import { CurrentUser } from './current-user.decorator.js';
import { EmailLoginService } from './email-login.service.js';
import {
  clearLoginNonceCookie,
  LOGIN_NONCE_COOKIE,
  readNonce,
  setLoginNonceCookie,
} from './login-nonce.cookie.js';
import { toMe } from './me.js';
import { newToken } from './secrets.js';
import { clearSessionCookie, setSessionCookie } from './session.cookie.js';
import { SessionService } from './session.service.js';

const nonceOf = (request: Request): string | undefined =>
  readNonce((request.cookies as Record<string, unknown> | undefined)?.[LOGIN_NONCE_COOKIE]);

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly emailLogin: EmailLoginService,
    private readonly sessions: SessionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Public()
  @RateLimit('emailCodeRequestPerIp')
  @Post('email-code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestCode(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { email } = emailCodeRequestSchema.parse(body);
    const nonce = nonceOf(request) ?? newToken();
    await this.emailLogin.request(email, nonce);
    setLoginNonceCookie(response, nonce);
  }

  @Public()
  @RateLimit('emailCodeVerifyPerIp')
  @Post('email-code/verify')
  @HttpCode(HttpStatus.OK)
  async verifyCode(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    const { email, code } = emailCodeVerifySchema.parse(body);
    const { user, token, expiresAt } = await this.emailLogin.verify(
      email,
      code,
      nonceOf(request),
      request.get('user-agent') ?? '',
    );
    clearLoginNonceCookie(response);
    setSessionCookie(response, token, expiresAt, this.clock());
    return toMe(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revoke(user.sessionId);
    clearSessionCookie(response);
  }
}
