import { ACCOUNTS, SIGNED_IN_BY_THEMSELVES, type AccountId } from './helpers/accounts';
import { signInThroughApi } from './helpers/api-sign-in';
import { createHousehold } from './helpers/households';

/**
 * Signs the accounts that the other specs use in once, instead of once per test, and gives each a
 * household (the app needs one). `setup` and `guest` are the exceptions: they have none and sign in
 * themselves.
 */
export default async function globalSetup(): Promise<void> {
  const accounts = (Object.keys(ACCOUNTS) as AccountId[]).filter(
    (account) => !SIGNED_IN_BY_THEMSELVES.includes(account),
  );
  for (const account of accounts) {
    await signInThroughApi(account);
    await createHousehold(account, `Haus ${account}`);
  }
}
