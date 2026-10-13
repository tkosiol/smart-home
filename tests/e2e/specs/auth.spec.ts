import { expect, test } from '@playwright/test';
import { mailsTo } from '../helpers/mailpit';
import { stateFile } from '../helpers/accounts';
import { loadWithServiceWorkerInControl } from '../helpers/service-worker';
import { signInThroughUi } from '../helpers/ui-sign-in';

// The people are created by infra/compose/test/stack-test.sh and signed in once by `global-setup.ts`
// (which also gives them a household). The API allows three codes per address in 15 minutes and ten
// per IP address: so each of `auth` and `theme` signs in through the page only once here and takes
// the saved session of `global-setup.ts` for the rest.

const OFFLINE_BANNER = 'Offline – Anzeigen können veraltet sein';

test('an anonymous visitor to the start page lands on the sign-in page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/anmelden(\?|$)/);
  await expect(page.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeVisible();
});

test('the emailed code signs in and the menu signs out again', async ({ page, context }) => {
  await test.step('sign in with the code from the mail', async () => {
    await signInThroughUi(page, 'auth');
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step('the session cookie is hardened', async () => {
    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name === '__Host-session');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(cookies.map((cookie) => cookie.name)).not.toContain('__Host-login-nonce');
  });

  await test.step('signing out leads to the sign-in page and closes the app', async () => {
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Mehr' })
      .click();
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/anmelden/);
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain('__Host-session');
    expect((await page.request.get('/api/v1/me')).status()).toBe(401);

    await page.goto('/');
    await expect(page).toHaveURL(/\/anmelden/);
    await expect(page.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeVisible();
  });
});

test('a theme chosen on one device arrives on another after signing in', async ({ browser }) => {
  const first = await browser.newContext({ storageState: stateFile('theme') });
  const second = await browser.newContext();
  try {
    const pageA = await first.newPage();
    await pageA.goto('/mehr/einstellungen/darstellung');
    const saved = pageA.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/me/preferences') && response.request().method() === 'PUT',
    );
    await pageA.getByRole('radio', { name: 'Dunkel' }).click();
    expect((await saved).status()).toBe(200);
    await expect(pageA.locator('html')).toHaveCSS('color-scheme', 'dark');

    const pageB = await second.newPage();
    await signInThroughUi(pageB, 'theme');
    await expect(pageB.locator('html')).toHaveCSS('color-scheme', 'dark');
    await pageB.goto('/mehr/einstellungen/darstellung');
    await expect(pageB.getByRole('radio', { name: 'Dunkel' })).toBeChecked();
  } finally {
    await first.close();
    await second.close();
  }
});

test.describe('a signed-in app', () => {
  test.use({ storageState: stateFile('auth') });

  test('starts offline with the offline banner', async ({ page, context }) => {
    await loadWithServiceWorkerInControl(page);
    await context.setOffline(true);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
    await expect(page.locator('ui-banner').getByText(OFFLINE_BANNER)).toBeVisible();
  });
});

test('an unknown address gets the same confirmation and no mail', async ({ page }) => {
  const stranger = 'nobody@example.org';
  await page.goto('/anmelden');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(stranger);
  await page.getByRole('button', { name: 'Code senden' }).click();

  await expect(page.getByText(`Wenn zu ${stranger} ein Konto gehört`)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Code (6 Ziffern)' })).toBeVisible();
  // The API hands a mail to the mail catcher after it has answered, within milliseconds; a second
  // is far more than that, and proving that nothing arrives needs some time to pass.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(await mailsTo(stranger)).toEqual([]);
});
