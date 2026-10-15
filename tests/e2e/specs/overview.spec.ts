import { expect, test, type Page } from '@playwright/test';
import { stateFile } from '../helpers/accounts';

// The overview of `theme`, in the household where `devices.spec.ts` registered the simulator (that
// spec has finished: this one runs in its own project after it, see `playwright.config.ts`, so
// nobody else changes this household or this person's layout meanwhile). The simulator's hardware
// that nobody has added yet is what the owner sees as notices. No test signs in with a code.
test.use({ storageState: stateFile('theme') });

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Übersicht anpassen' });
const openSheet = async (page: Page) => {
  await page.getByRole('button', { name: 'Übersicht anpassen' }).click();
  await expect(sheet(page)).toBeVisible();
};
/** The blocks of the overview in the order they are on the page. */
const blocks = (page: Page) =>
  page.locator('app-status-block, app-devices-block, app-gateway-block');

test.describe.serial('the overview of the simulator household', () => {
  test.describe.configure({ timeout: 90_000 });

  test.afterAll(async ({ browser }) => {
    // Whatever failed, leave the layout as a new user has it.
    const context = await browser.newContext({ storageState: stateFile('theme') });
    try {
      const page = await context.newPage();
      await page.goto('/');
      await expect(heading(page, 'Übersicht')).toBeVisible();
      await openSheet(page);
      await sheet(page).getByRole('button', { name: 'Zurücksetzen' }).click();
      await expect(sheet(page)).toBeHidden();
      // Closing the context too early would cancel the request that deletes the layout.
      await expect(blocks(page).first()).toHaveJSProperty('localName', 'app-status-block');
    } finally {
      await context.close();
    }
  });

  test('shows the hero with the notices of the simulator', async ({ page }) => {
    await page.goto('/');
    await expect(heading(page, 'Übersicht')).toBeVisible();
    // The simulator announced seven devices; the household has added at most one of them.
    const hero = page.getByRole('region', { name: /Braucht Aufmerksamkeit/ });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(/\d+ neue Geräte erkannt/);
    await expect(hero.getByRole('link', { name: /Alle \d+ Hinweise/ })).toBeVisible();
    // The pods of the devices are there too: the block "Geräte" is visible by default.
    await expect(page.locator('app-devices-block ui-device-pod').first()).toBeVisible();
  });

  test('a hidden block stays hidden after a reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-devices-block')).toBeVisible();
    await openSheet(page);
    await expect(sheet(page).getByRole('switch')).toHaveCount(3);
    await sheet(page).getByRole('switch', { name: 'Geräte anzeigen' }).click();
    await sheet(page).getByRole('button', { name: 'Fertig' }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator('app-devices-block')).toHaveCount(0);

    await page.reload();
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(page.getByRole('region', { name: /Braucht Aufmerksamkeit/ })).toBeVisible();
    await expect(page.locator('app-devices-block')).toHaveCount(0);
    // The sheet shows what was saved.
    await openSheet(page);
    await expect(sheet(page).getByRole('switch', { name: 'Geräte anzeigen' })).not.toBeChecked();
  });

  test('closing the sheet without "Fertig" discards the changes', async ({ page }) => {
    await page.goto('/');
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await openSheet(page);
    await sheet(page).getByRole('switch', { name: 'Status anzeigen' }).click();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await page.reload();
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(page.locator('app-status-block')).toBeVisible();
    await openSheet(page);
    await expect(sheet(page).getByRole('switch', { name: 'Status anzeigen' })).toBeChecked();
  });

  test('the order from the keyboard is kept, and "Zurücksetzen" brings the defaults back', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await openSheet(page);
    // Status moves below Geräte (which is hidden by the test before, but still in the list).
    await sheet(page).getByRole('button', { name: 'Status verschieben' }).focus();
    await page.keyboard.press('ArrowDown');
    await sheet(page).getByRole('switch', { name: 'Geräte anzeigen' }).click();
    await sheet(page).getByRole('button', { name: 'Fertig' }).click();
    await expect(sheet(page)).toBeHidden();
    // The page follows the new layout once the server has saved it: only then reload.
    await expect(blocks(page).first()).toHaveJSProperty('localName', 'app-devices-block');

    await page.reload();
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(blocks(page)).toHaveCount(2);
    await expect(blocks(page).first()).toHaveJSProperty('localName', 'app-devices-block');

    await openSheet(page);
    await sheet(page).getByRole('button', { name: 'Zurücksetzen' }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(blocks(page).first()).toHaveJSProperty('localName', 'app-status-block');
    await page.reload();
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(blocks(page)).toHaveCount(2);
    await expect(blocks(page).first()).toHaveJSProperty('localName', 'app-status-block');
  });
});
