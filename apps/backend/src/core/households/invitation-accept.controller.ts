import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import {
  invitationAcceptNewSchema,
  invitationTokenSchema,
  type InvitationPreview,
  type Me,
} from '@smart/contracts';
import type { Request, Response } from 'express';
import { Public, RateLimit } from '../../platform/http/index.js';
import {
  CLOCK,
  CurrentUser,
  MeService,
  SessionService,
  setSessionCookie,
  type AuthenticatedUser,
  type Clock,
} from '../identity/index.js';
import { InvitationsService } from './invitations.service.js';

/**
 * Whoever holds the link reaches these routes; the token is the secret and travels in the body, so
 * it appears in no URL, access log or Referer. Each route allows 20 requests per address in 15
 * minutes.
 */
@Controller('v1/invitations')
@RateLimit('invitationPerIp')
export class InvitationAcceptController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionService,
    private readonly meService: MeService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A POST (the token stays out of the URL), but it only reads. */
  @Public()
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: unknown): Promise<InvitationPreview> {
    return this.invitations.preview(invitationTokenSchema.parse(body).token);
  }

  /** For an account that exists: the signed-in user must own the invited address. */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(@CurrentUser() current: AuthenticatedUser, @Body() body: unknown): Promise<Me> {
    const { token } = invitationTokenSchema.parse(body);
    return this.meService.forUser(await this.invitations.accept(token, current.id));
  }

  /** For a new account: creates it and signs it in. */
  @Public()
  @Post('accept-new')
  @HttpCode(HttpStatus.OK)
  async acceptNew(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    const input = invitationAcceptNewSchema.parse(body);
    const user = await this.invitations.acceptNew(input.token, input);
    const session = await this.sessions.create(
      user.id,
      'invitation',
      request.get('user-agent') ?? '',
    );
    setSessionCookie(response, session.token, session.expiresAt, this.clock());
    return this.meService.forUser(user);
  }
}
