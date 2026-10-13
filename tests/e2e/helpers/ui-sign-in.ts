import { expect, type Page } from '@playwright/test';
import { ACCOUNTS, type AccountId } from './accounts';
import { codeFromNewMail, mailsTo } from './mailpit';

/**
 * Fills in the sign-in page that is open: address, code from the mail catcher, code. Costs one of
 * the account's three code requests per quarter hour.
 */
export async function completeSignInPage(page: Page, account: AccountId): Promise<void> {
  const { email } = ACCOUNTS[account];
  const seen = await mailsTo(email);
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByRole('button', { name: 'Code senden' }).click();
  const code = await codeFromNewMail(email, seen);
  await page.getByRole('textbox', { name: 'Code (6 Ziffern)' }).fill(code);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

/**
 * Signs `account` in through the sign-in page. Ends on the page with the heading `landing` (the
 * overview; an account without a household lands on the set-up page).
 */
export async function signInThroughUi(
  page: Page,
  account: AccountId,
  landing = 'Übersicht',
): Promise<void> {
  await page.goto('/anmelden');
  await completeSignInPage(page, account);
  await expect(page.getByRole('heading', { level: 1, name: landing })).toBeVisible();
}
