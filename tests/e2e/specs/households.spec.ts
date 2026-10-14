import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ACCOUNTS, stateFile } from '../helpers/accounts';
import { inviteThroughApi, resetInstanceAppearance } from '../helpers/households';
import { mailsTo, textOfNewMail } from '../helpers/mailpit';
import { completeSignInPage, signInThroughUi } from '../helpers/ui-sign-in';

// The people are created by infra/compose/test/stack-test.sh and `global-setup.ts` gives all of
// them but `setup` a household. The steps build on each other (the person who is invited first is
// removed later), so they run one after the other. `setup` and `guest` request one code each (see
// `SIGNED_IN_BY_THEMSELVES` for the budget of code requests).

const OWNER_HOUSEHOLD = 'Haus owner';
const NEWCOMER = { email: 'e2e-newcomer@example.org', name: 'Neu Hinzugekommen' };

const topBar = (page: Page) => page.locator('ui-top-app-bar');
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test.describe.serial('households, invitations and roles', () => {
  const opened: BrowserContext[] = [];
  let newcomer: Page;

  test.afterAll(async () => {
    for (const context of opened) await context.close();
  });

  test('a person without a household sets one up after signing in', async ({ browser }) => {
    const context = await browser.newContext();
    opened.push(context);
    const page = await context.newPage();
    await signInThroughUi(page, 'setup', 'Haushalt einrichten');
    await expect(page).toHaveURL(/\/einrichten$/);
    // Set-up stands outside the shell.
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0);

    await page.getByRole('textbox', { name: 'Name' }).fill('Testhaus');
    await page.getByRole('combobox', { name: 'Zeitzone' }).click();
    await page.getByRole('option', { name: 'Pacific/Chatham', exact: true }).click();
    await page.getByRole('button', { name: 'Haushalt anlegen' }).click();

    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(topBar(page)).toContainText('Testhaus');
    const me = (await (await page.request.get('/api/v1/me')).json()) as {
      households: { name: string; timezone: string; role: string }[];
    };
    expect(me.households).toMatchObject([
      { name: 'Testhaus', timezone: 'Pacific/Chatham', role: 'owner' },
    ]);
  });

  test('a new person accepts an invitation as viewer without an account', async ({ browser }) => {
    const { link } = await inviteThroughApi('owner', NEWCOMER.email, 'viewer');
    const context = await browser.newContext();
    opened.push(context);
    newcomer = await context.newPage();

    await newcomer.goto(link);
    // The token leaves the address at once (it waits in the session storage).
    await expect(newcomer).toHaveURL(/\/einladung$/);
    await expect(heading(newcomer, 'Einladung')).toBeVisible();
    await newcomer.getByRole('textbox', { name: 'Dein Name' }).fill(NEWCOMER.name);
    await newcomer.getByRole('button', { name: 'Annehmen' }).click();

    await expect(heading(newcomer, 'Übersicht')).toBeVisible();
    await expect(topBar(newcomer)).toContainText(OWNER_HOUSEHOLD);

    await newcomer
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Mehr' })
      .click();
    await expect(newcomer.getByRole('link', { name: /Mitglieder/ })).toBeVisible();
    await expect(newcomer.getByRole('link', { name: /Haushalt/ })).toHaveCount(0);

    await newcomer.getByRole('link', { name: /Mitglieder/ }).click();
    await expect(heading(newcomer, 'Mitglieder')).toBeVisible();
    await expect(newcomer.getByText(ACCOUNTS.owner.email)).toBeVisible();
    // A viewer only looks: nobody to remove or promote, nobody to invite.
    await expect(newcomer.getByRole('button', { name: 'Entfernen' })).toHaveCount(0);
    await expect(newcomer.getByRole('combobox')).toHaveCount(0);
    await expect(newcomer.getByRole('button', { name: 'Einladung senden' })).toHaveCount(0);
    await expect(newcomer.getByRole('heading', { name: 'Offene Einladungen' })).toHaveCount(0);
  });

  test('an existing account signs in through the invitation, accepts and switches households', async ({
    browser,
  }) => {
    const { email } = ACCOUNTS.guest;
    const seen = await mailsTo(email);
    const { link } = await inviteThroughApi('owner', email, 'member');
    // The mail carries the same link that the owner got in the answer.
    expect(await textOfNewMail(email, seen)).toContain(link);

    const context = await browser.newContext();
    opened.push(context);
    const page = await context.newPage();
    await page.goto(link);
    await expect(page).toHaveURL(/\/einladung$/);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/anmelden\?ziel=%2Feinladung$/);
    await completeSignInPage(page, 'guest');
    await expect(page).toHaveURL(/\/einladung$/);
    await page.getByRole('button', { name: 'Annehmen' }).click();

    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(topBar(page)).toContainText(OWNER_HOUSEHOLD);

    // With one household there is nothing to switch between.
    await expect(page.getByRole('link', { name: 'Haushalt wechseln' })).toHaveCount(0);
    await page.goto('/haushalte');
    await page.getByRole('link', { name: /Neuen Haushalt anlegen/ }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Haus guest');
    await page.getByRole('button', { name: 'Haushalt anlegen' }).click();
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(topBar(page)).toContainText('Haus guest');

    await page.getByRole('link', { name: 'Haushalt wechseln' }).click();
    await expect(heading(page, 'Haushalt wechseln')).toBeVisible();
    await page.getByRole('button', { name: `Zu ${OWNER_HOUSEHOLD} wechseln` }).click();
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(topBar(page)).toContainText(OWNER_HOUSEHOLD);
    await expect(topBar(page)).not.toContainText('Haus guest');
  });

  test('a removed member is sent to the set-up page on the next load', async ({ browser }) => {
    const context = await browser.newContext({ storageState: stateFile('owner') });
    opened.push(context);
    const owner = await context.newPage();
    await owner.goto('/mehr/mitglieder');
    const row = owner.locator('ui-section ui-section').filter({ hasText: NEWCOMER.email });
    await row.getByRole('button', { name: 'Entfernen' }).click();
    await row.getByRole('button', { name: 'Wirklich entfernen?' }).click();
    await expect(owner.getByText(NEWCOMER.email)).toHaveCount(0);

    await newcomer.reload();
    await expect(newcomer).toHaveURL(/\/einrichten$/);
    await expect(heading(newcomer, 'Haushalt einrichten')).toBeVisible();
  });
});

test('the instance theme the platform admin sets reaches signed-out visitors', async ({
  browser,
}) => {
  const primary = (page: Page) =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary').trim(),
    );
  const admin = await browser.newContext({ storageState: stateFile('owner') });
  const visitor = await browser.newContext();
  try {
    const adminPage = await admin.newPage();
    await adminPage.goto('/mehr/einstellungen/installation');
    await expect(
      adminPage.getByRole('heading', { level: 1, name: 'Erscheinungsbild der Installation' }),
    ).toBeVisible();
    await expect.poll(() => primary(adminPage)).toMatch(/^#[0-9a-f]{6}$/);
    const before = await primary(adminPage);

    const saved = adminPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/instance/appearance') &&
        response.request().method() === 'PUT',
    );
    await adminPage.getByRole('textbox', { name: 'Grundfarbe', exact: true }).fill('#8a5a00');
    expect((await saved).status()).toBe(200);
    await expect.poll(() => primary(adminPage)).not.toBe(before);
    const after = await primary(adminPage);

    const visitorPage = await visitor.newPage();
    await visitorPage.goto('/anmelden');
    await expect(heading(visitorPage, 'Anmelden')).toBeVisible();
    await expect.poll(() => primary(visitorPage)).toBe(after);
  } finally {
    // The other specs run against the same instance.
    await resetInstanceAppearance('owner');
    await admin.close();
    await visitor.close();
  }
});
