import path from 'node:path';

/**
 * The people of the stack test, created by `infra/compose/test/stack-test.sh` with the admin CLI.
 * Every spec file that needs a signed-in user has its own, so specs running in parallel never
 * change each other's saved settings; the sign-in specs have two more, because the API allows only
 * three codes per address and quarter of an hour. Keep the list in sync with the script. All of
 * them are platform admins (the script creates them with the admin CLI).
 */
export const ACCOUNTS = {
  shell: { email: 'e2e-shell@example.org' },
  smoke: { email: 'e2e-smoke@example.org' },
  auth: { email: 'e2e-auth@example.org' },
  theme: { email: 'e2e-theme@example.org' },
  /** Has no household: signs in on the sign-in page and has to set one up. */
  setup: { email: 'e2e-setup@example.org' },
  /** Owner of the household that `households.spec.ts` invites people into. */
  owner: { email: 'e2e-owner@example.org' },
  /** Has no household either: accepts an invitation of the owner by signing in, then adds one. */
  guest: { email: 'e2e-guest@example.org' },
} as const;
export type AccountId = keyof typeof ACCOUNTS;

/**
 * Accounts that `global-setup.ts` leaves alone: they sign in through the page themselves. Besides
 * the three codes per address, the API allows ten code requests per IP address and quarter of an
 * hour, and a run uses all ten: one per account of `global-setup.ts`, one each for `setup`, `guest`,
 * the sign-in test of `auth`, the second device of `theme` and the unknown address of `auth`.
 */
export const SIGNED_IN_BY_THEMSELVES: readonly AccountId[] = ['setup', 'guest'];

/** The browser state (cookies, device copy) that `global-setup.ts` saves after signing in. */
export function stateFile(account: AccountId): string {
  return path.join(import.meta.dirname, '..', '.auth', `${account}.json`);
}
