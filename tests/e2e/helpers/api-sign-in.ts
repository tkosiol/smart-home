import { expect, request } from '@playwright/test';
import { ACCOUNTS, stateFile, type AccountId } from './accounts';
import { BASE_URL } from './env';
import { codeFromNewMail, mailsTo } from './mailpit';

/**
 * Signs `account` in through the API (code request, mail from Mailpit, verification) and saves the
 * cookies for `storageState`. Costs one of the account's three code requests per quarter hour.
 */
export async function signInThroughApi(account: AccountId): Promise<void> {
  const { email } = ACCOUNTS[account];
  const api = await request.newContext({
    baseURL: BASE_URL,
    // The API refuses unsafe requests that do not come from the app's own origin.
    extraHTTPHeaders: { Origin: new URL(BASE_URL).origin },
  });
  try {
    const seen = await mailsTo(email);
    expect((await api.post('/api/v1/auth/email-code', { data: { email } })).status()).toBe(204);
    const code = await codeFromNewMail(email, seen);
    const verified = await api.post('/api/v1/auth/email-code/verify', { data: { email, code } });
    expect(verified.status()).toBe(200);
    await api.storageState({ path: stateFile(account) });
  } finally {
    await api.dispose();
  }
}

/** Puts the saved settings of `account` back to what a new user has (the specs change them). */
export async function resetPreferences(account: AccountId): Promise<void> {
  const api = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Origin: new URL(BASE_URL).origin },
    storageState: stateFile(account),
  });
  try {
    const response = await api.put('/api/v1/me/preferences', {
      data: { locale: 'de', appearance: { mode: 'system', contrast: 'system' } },
    });
    expect(response.status()).toBe(200);
  } finally {
    await api.dispose();
  }
}
