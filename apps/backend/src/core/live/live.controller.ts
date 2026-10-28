import { Controller, Get, HttpStatus, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  HouseholdGuard,
  membershipOf,
  RequireRole,
  type HouseholdRequest,
} from '../households/index.js';
import { UsersRepository } from '../identity/index.js';
import { ApiError } from '../../platform/http/index.js';
import { LiveHub } from './live-hub.js';
import { SSE_CONNECTED } from './sse.js';

@Controller('v1/households/:householdId')
@UseGuards(HouseholdGuard)
export class LiveController {
  constructor(
    private readonly hub: LiveHub,
    private readonly users: UsersRepository,
  ) {}

  /** The household's live events as a Server-Sent-Events stream (kept open until either side ends). */
  @Get('events')
  @RequireRole('viewer')
  async events(@Req() request: HouseholdRequest, @Res() response: Response): Promise<void> {
    const membership = membershipOf(request);
    const { user: session } = request;
    if (!session) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    // Before the first await: a client that leaves meanwhile must not be registered afterwards.
    let gone = false;
    const registration: { remove?: () => void } = {};
    response.on('close', () => {
      gone = true;
      registration.remove?.();
    });
    const user = await this.users.findById(session.id);
    if (gone) return;
    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write(SSE_CONNECTED);
    registration.remove = this.hub.add({
      householdId: membership.householdId,
      userId: session.id,
      sessionId: session.sessionId,
      audience: { role: membership.role, isPlatformAdmin: user?.isPlatformAdmin ?? false },
      write: (chunk) => response.write(chunk),
      close: () => response.end(),
    });
  }
}
