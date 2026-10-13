import path from 'node:path';

/**
 * The people of the stack test, created by `infra/compose/test/stack-test.sh` with the admin CLI.
 * Every spec file that needs a signed-in user has its own, so specs running in parallel never
 * change each other's saved settings; the sign-in specs have two more, because the API allows only
 * three codes per address and quarter of an hour. Keep the list in sync with the script.
 */
export const ACCOUNTS = {
  shell: { email: 'e2e-shell@example.org' },
  smoke: { email: 'e2e-smoke@example.org' },
  auth: { email: 'e2e-auth@example.org' },
  theme: { email: 'e2e-theme@example.org' },
} as const;
export type AccountId = keyof typeof ACCOUNTS;

/** The browser state (cookies, device copy) that `global-setup.ts` saves after signing in. */
export function stateFile(account: AccountId): string {
  return path.join(import.meta.dirname, '..', '.auth', `${account}.json`);
}
