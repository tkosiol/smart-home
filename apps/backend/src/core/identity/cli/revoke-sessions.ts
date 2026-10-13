import { emailSchema } from '@smart/contracts';
import type { Clock } from '../clock.js';
import type { SessionsRepository } from '../sessions.repository.js';
import type { UsersRepository } from '../users.repository.js';
import { CliInputError } from './create-admin.js';

/** Revokes all open sessions of the user, so every device has to sign in again. */
export async function revokeSessions(
  deps: { users: UsersRepository; sessions: SessionsRepository; clock: Clock },
  input: { email?: string },
): Promise<{ revoked: number; email: string }> {
  if (input.email === undefined) throw new CliInputError('missing --email');
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) throw new CliInputError('invalid e-mail address');
  const email = parsed.data;

  const user = await deps.users.findByEmail(email);
  // The unknown address is not echoed back.
  if (!user) throw new CliInputError('no such user');
  return { revoked: await deps.sessions.revokeAllForUser(user.id, deps.clock()), email };
}
