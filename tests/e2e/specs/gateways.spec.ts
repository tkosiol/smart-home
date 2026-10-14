import { expect, test, type Page } from '@playwright/test';
import { stateFile } from '../helpers/accounts';
import { testGateway } from '../helpers/gateways';

// `owner` is a platform admin and the owner of "Haus owner" (see `global-setup.ts`), so it sees the
// list and the form. The gateways are the ones `stack-test.sh` started: the Pi's Mosquitto bridged
// over mTLS, and the simulator on the internal listener. The steps build on each other (the Pi's
// gateway is registered once, then refused as taken), so they run one after the other. No test
// signs in: the saved state of `owner` is used (the budget of code requests is used up).
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

  test("the simulator's gateway registers and Zigbee2MQTT is online", async ({ page }) => {
    await page.goto('/mehr/gateways');
    await register(page, 'Simulator', testGateway('simulator').certificate);
    const block = gatewayBlock(page, 'Simulator');
    await expect(block).toBeVisible();
    await expect(block).toContainText('Zigbee2MQTT: Online');
    await expect(block).toContainText('Bridge: Online');
    await expect(block).toContainText(/Letzte Nachricht|Noch keine Nachricht empfangen/);
  });

  test('a gateway that is already registered is refused with a message', async ({ page }) => {
    await page.goto('/mehr/gateways');
    await register(page, 'Noch einmal', testGateway('pi').certificate);
    await expect(page.getByText('Dieses Gateway ist schon registriert.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch einmal' })).toHaveCount(0);
  });

  test('the list survives a reload with both gateways and their status', async ({ page }) => {
    await page.goto('/mehr/gateways');
    await expect(gatewayBlock(page, 'Pi Wohnzimmer')).toContainText('Bridge: Online');
    await expect(gatewayBlock(page, 'Simulator')).toContainText('Zigbee2MQTT: Online');
  });

  test('revoking asks twice, then marks the gateway and reminds of the broker', async ({
    page,
  }) => {
    await page.goto('/mehr/gateways');
    const block = gatewayBlock(page, 'Simulator');
    await block.getByRole('button', { name: 'Sperren' }).click();
    await expect(block.getByRole('button', { name: 'Wirklich sperren?' })).toBeVisible();
    await block.getByRole('button', { name: 'Wirklich sperren?' }).click();
    await expect(block).toContainText('Gesperrt am');
    await expect(page.getByText(/Sperre jetzt auch sein Zertifikat/)).toBeVisible();
    // The Pi's gateway is untouched.
    await expect(gatewayBlock(page, 'Pi Wohnzimmer')).toContainText('Bridge: Online');
  });
});
