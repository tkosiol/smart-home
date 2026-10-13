import { expect, type Page } from '@playwright/test';
import { ACCOUNTS, type AccountId } from './accounts';
import { codeFromNewMail, mailsTo } from './mailpit';

/**
 * Signs `account` in through the sign-in page: address, code from the mail catcher, code. Ends on
 * the overview. Costs one of the account's three code requests per quarter hour.
 */
export async function signInThroughUi(page: Page, account: AccountId): Promise<void> {
  const { email } = ACCOUNTS[account];
  const seen = await mailsTo(email);
  await page.goto('/anmelden');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByRole('button', { name: 'Code senden' }).click();
  const code = await codeFromNewMail(email, seen);
  await page.getByRole('textbox', { name: 'Code (6 Ziffern)' }).fill(code);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
}
