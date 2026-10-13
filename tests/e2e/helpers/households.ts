import { expect, request, type APIRequestContext } from '@playwright/test';
import { stateFile, type AccountId } from './accounts';
import { BASE_URL } from './env';

/** The parts of the API's answers that the specs read. */
interface Me {
  currentHouseholdId: string | null;
}
interface InvitationCreated {
  link: string;
}

/** The API refuses unsafe requests that do not come from the app's own origin. */
const ORIGIN = new URL(BASE_URL).origin;

/** An API client with the session that `global-setup.ts` saved for `account`. */
export function apiAs(account: AccountId): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Origin: ORIGIN },
    storageState: stateFile(account),
  });
}

/** Creates a household of which `account` is the owner (all existing specs need one). */
export async function createHousehold(
  account: AccountId,
  name: string,
  timezone = 'Europe/Berlin',
): Promise<Me> {
  const api = await apiAs(account);
  try {
    const response = await api.post('/api/v1/households', { data: { name, timezone } });
    expect(response.status()).toBe(201);
    return (await response.json()) as Me;
  } finally {
    await api.dispose();
  }
}

/** Invites `email` into the household `account` owns; the link comes from the answer, not a mail. */
export async function inviteThroughApi(
  account: AccountId,
  email: string,
  role: 'viewer' | 'member' | 'owner',
): Promise<InvitationCreated> {
  const api = await apiAs(account);
  try {
    const me = (await (await api.get('/api/v1/me')).json()) as Me;
    const householdId = me.currentHouseholdId;
    if (!householdId) throw new Error(`${account} has no current household`);
    const response = await api.post(`/api/v1/households/${householdId}/invitations`, {
      data: { email, role },
    });
    expect(response.status()).toBe(201);
    return (await response.json()) as InvitationCreated;
  } finally {
    await api.dispose();
  }
}

/** Puts the instance appearance back to "none stored" (platform admin only). */
export async function resetInstanceAppearance(account: AccountId): Promise<void> {
  const api = await apiAs(account);
  try {
    const response = await api.put('/api/v1/instance/appearance', { data: { appearance: null } });
    expect(response.status()).toBe(200);
  } finally {
    await api.dispose();
  }
}
