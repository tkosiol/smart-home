import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

/** A request after `SessionGuard`; `user` is absent on `@Public()` routes. */
export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
