import { test as base } from '@playwright/test';
import { stateFile, type AccountId } from './accounts';
import { resetPreferences } from './api-sign-in';

/**
 * `test` whose pages are signed in as `account` (set with `test.use({ account })`): the session
 * comes from `global-setup.ts`, and the person's saved theme and language are reset before every
 * test, because the app stores what a test changes on the account.
 */
export const test = base.extend<{ account: AccountId }>({
  account: ['shell', { option: true }],
  storageState: async ({ account }, use) => {
    await use(stateFile(account));
  },
  page: async ({ page, account }, use) => {
    await resetPreferences(account);
    await use(page);
  },
});
