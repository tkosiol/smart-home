import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { invitationAcceptNewSchema, type InvitationPreview, type Me } from '@smart/contracts';
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
 * Whoever holds the link reaches these routes; the token in the path is the secret. All three are
 * limited per address (20 in 15 minutes each).
 */
@Controller('v1/invitations/:token')
@RateLimit('invitationPerIp')
export class InvitationAcceptController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionService,
    private readonly meService: MeService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Public()
  @Get()
  preview(@Param('token') token: string): Promise<InvitationPreview> {
    return this.invitations.preview(token);
  }

  /** For an account that exists: the signed-in user must own the invited address. */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() current: AuthenticatedUser,
    @Param('token') token: string,
  ): Promise<Me> {
    return this.meService.forUser(await this.invitations.accept(token, current.id));
  }

  /** For a new account: creates it and signs it in. */
  @Public()
  @Post('accept-new')
  @HttpCode(HttpStatus.OK)
  async acceptNew(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    const input = invitationAcceptNewSchema.parse(body);
    const user = await this.invitations.acceptNew(token, input);
    const session = await this.sessions.create(
      user.id,
      'invitation',
      request.get('user-agent') ?? '',
    );
    setSessionCookie(response, session.token, session.expiresAt, this.clock());
    return this.meService.forUser(user);
  }
}
