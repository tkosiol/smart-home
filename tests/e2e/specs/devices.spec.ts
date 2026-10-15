import { expect, test, type Locator, type Page } from '@playwright/test';
import { stateFile } from '../helpers/accounts';
import { testGateway } from '../helpers/gateways';
import { inviteThroughApi } from '../helpers/households';

// `theme` is the owner of its own household "Haus theme" (see `global-setup.ts`) and no other spec
// changes that household, so the devices registered here do not disturb anyone. This spec registers
// the simulator's gateway itself (nobody else does: `gateways.spec.ts` works with the Pi's gateway
// only) and adds one of its devices. The simulator reports every few seconds (see
// `SIMULATOR_INTERVAL_SECONDS` in `stack-test.sh`). The steps build on each other, so they run one
// after the other. No test signs in with a code (the budget of code requests is used up): the
// owner uses the saved state of `theme`, the member is invited by the API and accepts as a new
// person, which needs no code.
test.use({ storageState: stateFile('theme') });

const MEMBER = { email: 'e2e-devices-member@example.org', name: 'Mitglied Geräte' };
/** What the simulator announces (apps/gateway-simulator/fixtures/devices.json). */
const SIMULATED = [
  'Pflanze 1',
  'Pflanze 2',
  'Pflanze 3',
  'Pflanze 4',
  'Pflanze 5',
  'Pflanze 6',
  'Lampe',
];
/** Long enough for a few reports of the simulator, which sends one every few seconds. */
const REPORTS = 60_000;

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
/** The "Neu erkannt" section of the devices page. */
const discovered = (page: Page) =>
  page.locator('ui-section').filter({ has: page.getByRole('heading', { name: 'Neu erkannt' }) });
/** The card of one hardware or device with this heading, inside `scope` (the whole page by default). */
const card = (page: Page, name: string, scope: Locator = page.locator('body')) =>
  scope.locator('ui-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
/** The pod of a device on the overview: a link named by its value, name and side value. */
const pod = (page: Page, name: string) =>
  page.locator('app-devices-block ui-device-pod').filter({ hasText: name });

/** The "Messwerte" section of the device page. */
const readingsOf = (page: Page) =>
  page.locator('ui-section').filter({ has: page.getByRole('heading', { name: 'Messwerte' }) });

/** Reloads until the soil moisture of a report is on the page (the simulator reports often). */
async function expectSoilMoisture(page: Page): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(readingsOf(page)).toContainText(/Bodenfeuchte:\s*\d/, { timeout: 5_000 });
  }).toPass({ timeout: REPORTS });
}

test.describe.serial('devices from the simulator', () => {
  // A reading can take a few reports of the simulator to arrive; the default of 30 s is tight.
  test.describe.configure({ timeout: 90_000 });

  test('the owner registers the simulator and its Zigbee2MQTT is online', async ({ page }) => {
    await page.goto('/mehr/gateways');
    await expect(heading(page, 'Gateways')).toBeVisible();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Simulator');
    await page
      .getByRole('textbox', { name: 'Zertifikat', exact: true })
      .fill(testGateway('simulator').certificate);
    await page.getByRole('button', { name: 'Gateway registrieren' }).click();
    const block = page.locator('ui-section ui-section').filter({ hasText: 'Simulator' });
    await expect(block).toBeVisible();
    await expect(block).toContainText('Zigbee2MQTT: Online');
    await expect(block).toContainText('Bridge: Online');
    await expect(block).toContainText(/Letzte Nachricht|Noch keine Nachricht empfangen/);
  });

  test('without devices the overview points to "Geräte"', async ({ page }) => {
    await page.goto('/');
    await expect(heading(page, 'Übersicht')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch keine Geräte' })).toBeVisible();
    await expect(page.getByText('„Geräte → Neu erkannt“')).toBeVisible();
    await page.getByRole('link', { name: 'Zu den Geräten' }).click();
    await expect(page).toHaveURL(/\/geraete$/);
    await expect(heading(page, 'Geräte')).toBeVisible();
  });

  test('"Neu erkannt" lists the seven simulated devices, showing readings only', async ({
    page,
  }) => {
    await page.goto('/geraete');
    await expect(heading(page, 'Geräte')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch keine Geräte' })).toBeVisible();

    const section = discovered(page);
    await expect(section.locator('ui-card')).toHaveCount(SIMULATED.length);
    for (const name of SIMULATED) {
      await expect(card(page, name, section)).toBeVisible();
      // The name field starts with the name Zigbee2MQTT gives the hardware.
      await expect(card(page, name, section).getByRole('textbox', { name: 'Name' })).toHaveValue(
        name,
      );
    }
    // Only readings: no settings of the soil sensor (calibration, sampling, unit, warning).
    await expect(section).not.toContainText(/calibration|sampling|temperature_unit|soil_warning/);
  });

  test('adding "Pflanze 1" moves it from "Neu erkannt" to the devices', async ({ page }) => {
    await page.goto('/geraete');
    const section = discovered(page);
    await card(page, 'Pflanze 1', section).getByRole('button', { name: 'Hinzufügen' }).click();

    await expect(section.locator('ui-card')).toHaveCount(SIMULATED.length - 1);
    await expect(card(page, 'Pflanze 1', section)).toHaveCount(0);
    const list = page.locator('ui-section').filter({
      has: page.getByRole('heading', { name: 'Geräte im Haushalt' }),
    });
    await expect(card(page, 'Pflanze 1', list)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch keine Geräte' })).toHaveCount(0);
  });

  test('the soil moisture shows on the device page and on the overview', async ({ page }) => {
    await page.goto('/geraete');
    await card(page, 'Pflanze 1').getByRole('link', { name: 'Details' }).click();
    await expect(page).toHaveURL(/\/geraete\/[0-9a-f-]+$/);
    await expect(heading(page, 'Pflanze 1')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Messwerte' })).toBeVisible();
    await expectSoilMoisture(page);
    const readings = readingsOf(page);
    await expect(readings).toContainText('Batterie');
    // The settings of the sensor are no readings.
    await expect(readings).not.toContainText(/calibration|sampling|Kalibrierung/);
    await expect(page.getByRole('heading', { name: 'Hardware' })).toBeVisible();

    await page.goto('/');
    await expect(heading(page, 'Übersicht')).toBeVisible();
    const overview = pod(page, 'Pflanze 1');
    await expect(overview).toBeVisible();
    // The soil moisture is the value of the pod, in front of the name.
    await expect(overview).toContainText(/\d+(,\d)?\s*%\s*Pflanze 1/);
    await overview.getByRole('link').click();
    await expect(page).toHaveURL(/\/geraete\/[0-9a-f-]+$/);
  });

  test('a member of the household sees the device but not "Neu erkannt"', async ({ browser }) => {
    const { link } = await inviteThroughApi('theme', MEMBER.email, 'member');
    // A new person: the saved state of `theme`, which this file uses, must not apply.
    const context = await browser.newContext({ storageState: undefined });
    try {
      const page = await context.newPage();
      await page.goto(link);
      await expect(page).toHaveURL(/\/einladung$/);
      await page.getByRole('textbox', { name: 'Dein Name' }).fill(MEMBER.name);
      await page.getByRole('button', { name: 'Annehmen' }).click();
      await expect(heading(page, 'Übersicht')).toBeVisible();
      await expect(pod(page, 'Pflanze 1')).toBeVisible();

      await page
        .getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('link', { name: 'Geräte' })
        .click();
      await expect(heading(page, 'Geräte')).toBeVisible();
      await expect(card(page, 'Pflanze 1')).toBeVisible();
      // The hardware of the other devices is for owners: not even the heading, and no way to add.
      await expect(page.getByRole('heading', { name: 'Neu erkannt' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Hinzufügen' })).toHaveCount(0);
      await expect(page.getByText('Pflanze 2')).toHaveCount(0);

      // A member can rename the device.
      await card(page, 'Pflanze 1').getByRole('link', { name: 'Details' }).click();
      await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Pflanze 1');
      await page.getByRole('textbox', { name: 'Name' }).fill('Basilikum');
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(heading(page, 'Basilikum')).toBeVisible();
      await page.goto('/geraete');
      await expect(card(page, 'Basilikum')).toBeVisible();
      await expect(card(page, 'Pflanze 1')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
  test("the simulator's gateway is not touched by the revoking of the Pi's gateway", async ({
    page,
  }) => {
    // `gateways.spec.ts` registers the Pi's gateway in another household and revokes it, in
    // parallel with this spec; whenever that happens, this household's gateway stays as it was.
    await page.goto('/mehr/gateways');
    const block = page.locator('ui-section ui-section').filter({ hasText: 'Simulator' });
    await expect(block).toContainText('Bridge: Online');
    await expect(block).toContainText('Zigbee2MQTT: Online');
    await expect(block).not.toContainText('Gesperrt am');
  });
});
