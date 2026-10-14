import { expect, test, type Page } from '@playwright/test';
import { stateFile } from '../helpers/accounts';
import { testGateway } from '../helpers/gateways';

// `owner` is a platform admin and the owner of "Haus owner" (see `global-setup.ts`), so it sees the
// list and the form. The gateway is the one `stack-test.sh` started: the Pi's Mosquitto bridged
// over mTLS. The simulator's gateway can be registered only once, so `devices.spec.ts` takes it
// (in its own household) and this spec leaves it alone. The steps build on each other (the Pi's
// gateway is registered once, then refused as taken, then revoked), so they run one after the
// other. No test signs in: the saved state of `owner` is used (the budget of code requests is used
// up).
test.use({ storageState: stateFile('owner') });

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
/** The block of one gateway in the list (a section inside the "Registrierte Gateways" section). */
const gatewayBlock = (page: Page, name: string) =>
  page.locator('ui-section ui-section').filter({ hasText: name });

async function register(page: Page, name: string, certificate: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Zertifikat', exact: true }).fill(certificate);
  await page.getByRole('button', { name: 'Gateway registrieren' }).click();
}

test.describe.serial('registering gateways', () => {
  test('an empty list explains how a gateway gets here', async ({ page }) => {
    await page.goto('/mehr/gateways');
    await expect(heading(page, 'Gateways')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch keine Gateways' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gateway registrieren' })).toBeVisible();
  });

  test('the owner finds Gateways under More', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Mehr' })
      .click();
    await page.getByRole('link', { name: /Gateways/ }).click();
    await expect(heading(page, 'Gateways')).toBeVisible();
  });

  test('a text that is no certificate shows the translated message', async ({ page }) => {
    await page.goto('/mehr/gateways');
    await register(page, 'Kaputt', 'das ist kein Zertifikat');
    await expect(
      page.getByText(
        'Das Zertifikat ist ungültig, abgelaufen oder nicht von dieser Instanz ausgestellt.',
      ),
    ).toBeVisible();
    // Nothing was registered.
    await expect(page.getByRole('heading', { name: 'Kaputt' })).toHaveCount(0);
  });

  test("the Pi's gateway registers by its certificate and its bridge is online", async ({
    page,
  }) => {
    await page.goto('/mehr/gateways');
    await register(page, 'Pi Wohnzimmer', testGateway('pi').certificate);
    const block = gatewayBlock(page, 'Pi Wohnzimmer');
    await expect(block).toBeVisible();
    // The broker holds the retained "1" of the bridge's connection topic; the backend applies it at registration.
    await expect(block).toContainText('Bridge: Online');
    await expect(block).toContainText('Zertifikat gültig bis');
    // The form is empty again for the next gateway.
    await expect(page.getByRole('textbox', { name: 'Zertifikat', exact: true })).toHaveValue('');
  });

  test('a gateway that is already registered is refused with a message', async ({ page }) => {
    await page.goto('/mehr/gateways');
    await register(page, 'Noch einmal', testGateway('pi').certificate);
    await expect(page.getByText('Dieses Gateway ist schon registriert.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch einmal' })).toHaveCount(0);
  });

  test('the list survives a reload with the gateway and its status', async ({ page }) => {
    await page.goto('/mehr/gateways');
    await expect(gatewayBlock(page, 'Pi Wohnzimmer')).toContainText('Bridge: Online');
    await expect(gatewayBlock(page, 'Pi Wohnzimmer')).toContainText('Zertifikat gültig bis');
  });

  test('revoking asks twice, then marks the gateway and reminds of the broker', async ({
    page,
  }) => {
    await page.goto('/mehr/gateways');
    const block = gatewayBlock(page, 'Pi Wohnzimmer');
    await block.getByRole('button', { name: 'Sperren' }).click();
    await expect(block.getByRole('button', { name: 'Wirklich sperren?' })).toBeVisible();
    await block.getByRole('button', { name: 'Wirklich sperren?' }).click();
    await expect(block).toContainText('Gesperrt am');
    await expect(page.getByText(/Sperre jetzt auch sein Zertifikat/)).toBeVisible();
  });
});
