import { emailSchema } from '@smart/contracts';
import type { UsersRepository } from '../users.repository.js';

export type CreateAdminOutcome = 'created' | 'promoted' | 'unchanged';

/** The input is wrong; the message is meant for the person at the terminal. */
export class CliInputError extends Error {}

/**
 * Creates the user as platform admin, or makes an existing user one (the profile of an existing
 * user is left alone). Running it again changes nothing.
 */
export async function createAdmin(
  users: UsersRepository,
  input: { email?: string; name?: string },
): Promise<{ outcome: CreateAdminOutcome; email: string }> {
  if (input.email === undefined) throw new CliInputError('missing --email');
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) throw new CliInputError('invalid e-mail address');
  const email = parsed.data;

  const existing = await users.findByEmail(email);
  if (existing) {
    if (existing.isPlatformAdmin) return { outcome: 'unchanged', email };
    await users.setPlatformAdmin(existing.id);
    return { outcome: 'promoted', email };
  }

  const name = input.name?.trim();
  if (!name) throw new CliInputError('missing --name');
  await users.create({ email, displayName: name, locale: 'de', isPlatformAdmin: true });
  return { outcome: 'created', email };
}
