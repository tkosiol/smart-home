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
/** The "Neu erkannt" card of the devices page. */
const discovered = (page: Page) =>
  page.locator('ui-card').filter({ has: page.getByRole('heading', { name: 'Neu erkannt' }) });
/** The form of one found hardware in "Neu erkannt": its pod carries the hardware's name. */
const found = (page: Page, name: string) =>
  discovered(page)
    .locator('form')
    .filter({ has: page.locator('ui-device-pod').filter({ hasText: name }) });
/** The pod of a device, inside `scope` (the whole page by default): a link named by value and name. */
const pod = (page: Page, name: string, scope: Locator = page.locator('body')) =>
  scope.locator('ui-device-pod').filter({ hasText: name });

/** The "Messwerte" section of the device page. */
const readingsOf = (page: Page) =>
  page.locator('ui-section').filter({ has: page.getByRole('heading', { name: 'Messwerte' }) });

/** Reloads until the soil moisture of a report is the hero's value (the simulator reports often). */
async function expectSoilMoisture(page: Page): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(readingsOf(page)).toContainText('Bodenfeuchte', { timeout: 5_000 });
    await expect(page.locator('ui-value-display[data-size="hero"]')).toContainText(/\d/, {
      timeout: 5_000,
    });
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
    const block = page.locator('ui-card').filter({ hasText: 'Simulator' });
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
    await expect(section.locator('form')).toHaveCount(SIMULATED.length);
    for (const name of SIMULATED) {
      await expect(found(page, name)).toBeVisible();
      // The name field starts with the name Zigbee2MQTT gives the hardware.
      await expect(found(page, name).getByRole('textbox', { name: 'Name' })).toHaveValue(name);
    }
    // Only readings: no settings of the soil sensor (calibration, sampling, unit, warning).
    await expect(section).not.toContainText(/calibration|sampling|temperature_unit|soil_warning/);
  });

  test('adding "Pflanze 1" moves it from "Neu erkannt" to the devices', async ({ page }) => {
    await page.goto('/geraete');
    const section = discovered(page);
    await found(page, 'Pflanze 1').getByRole('button', { name: 'Hinzufügen' }).click();

    await expect(section.locator('form')).toHaveCount(SIMULATED.length - 1);
    await expect(found(page, 'Pflanze 1')).toHaveCount(0);
    const list = page.locator('ui-section').filter({
      has: page.getByRole('heading', { name: 'Geräte im Haushalt' }),
    });
    await expect(pod(page, 'Pflanze 1', list)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch keine Geräte' })).toHaveCount(0);
  });

  test('the soil moisture shows on the device page and on the overview', async ({ page }) => {
    await page.goto('/geraete');
    await pod(page, 'Pflanze 1').getByRole('link').click();
    await expect(page).toHaveURL(/\/geraete\/[0-9a-f-]+$/);
    await expect(heading(page, 'Pflanze 1')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Messwerte' })).toBeVisible();
    await expectSoilMoisture(page);
    const readings = readingsOf(page);
    // The side values of the hero are pods: temperature, battery and signal.
    await expect(readings).toContainText('Batterie');
    // The settings of the sensor are no readings.
    await expect(readings).not.toContainText(/calibration|sampling|Kalibrierung/);
    await expect(page.getByRole('heading', { name: 'Hardware' })).toBeVisible();

    await page.goto('/');
    await expect(heading(page, 'Übersicht')).toBeVisible();
    const overview = pod(page, 'Pflanze 1', page.locator('app-devices-block'));
    await expect(overview).toBeVisible();
    // The soil moisture is the value of the pod, in front of the name.
    await expect(overview).toContainText(/\d+(,\d)?\s*%\s*Pflanze 1/);
    await overview.getByRole('link').click();
    await expect(page).toHaveURL(/\/geraete\/[0-9a-f-]+$/);
  });

  test('the history card charts the soil moisture and offers a table', async ({ page }) => {
    await page.goto('/geraete');
    await pod(page, 'Pflanze 1').getByRole('link').click();
    await expect(heading(page, 'Pflanze 1')).toBeVisible();
    const card = page
      .locator('ui-card')
      .filter({ has: page.getByRole('heading', { name: 'Verlauf' }) });
    await expect(card).toBeVisible();
    // Reports arrive every few seconds: reload until the chart has data (no chart while empty).
    await expect(async () => {
      await page.reload();
      await expect(card.locator('ui-chart')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: REPORTS });
    await expect(card.getByRole('group', { name: /Bodenfeuchte/ }).first()).toBeVisible();

    await card.getByRole('radio', { name: '24 h' }).click();
    await expect(card.getByRole('radio', { name: '24 h' })).toBeChecked();
    await expect(card.locator('ui-chart')).toBeVisible();

    // The 4 weeks (daily values): the chart or its empty text, never the error state. The
    // simulator has only minutes of data, so the table has today's row once a reading exists.
    await card.getByRole('radio', { name: '4 Wochen' }).click();
    await expect(card.getByRole('radio', { name: '4 Wochen' })).toBeChecked();
    await expect(card.getByText('Der Verlauf konnte nicht geladen werden.')).toHaveCount(0);
    await expect(
      card.locator('ui-chart').or(card.getByText('Noch keine Messwerte in diesem Zeitraum')),
    ).toBeVisible();
    await card.getByRole('button', { name: 'Werte als Tabelle' }).click();
    await expect(
      card
        .locator('ui-value-table tbody tr')
        .first()
        .or(card.getByText('Noch keine Messwerte in diesem Zeitraum')),
    ).toBeVisible();
    await expect(card.getByText('Der Verlauf konnte nicht geladen werden.')).toHaveCount(0);

    await card.getByRole('radio', { name: '24 h' }).click();
    await expect(card.locator('ui-value-table tbody tr').first()).toBeVisible();
  });

  test('a new reading shows on the open device page without a reload or a request', async ({
    page,
  }) => {
    await page.goto('/geraete');
    await pod(page, 'Pflanze 1').getByRole('link').click();
    await expect(page).toHaveURL(/\/geraete\/[0-9a-f-]+$/);
    await expectSoilMoisture(page);
    // The temperature carries one decimal and noise on every report: it changes on most reports.
    const temperature = pod(page, 'Temperatur', readingsOf(page));
    await expect(temperature).toContainText(/\d/);
    const first = await temperature.innerText();

    // From here on, a request for the device would mean polling instead of the stream.
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/v1\/households\/[^/]+\/devices\/[^/?]+(\?|$)/.test(request.url())) {
        requests.push(request.url());
      }
    });
    await expect.poll(async () => temperature.innerText(), { timeout: 45_000 }).not.toBe(first);
    expect(requests).toEqual([]);
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
      await expect(pod(page, 'Pflanze 1', page.locator('app-devices-block'))).toBeVisible();

      await page
        .getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('link', { name: 'Geräte' })
        .click();
      await expect(heading(page, 'Geräte')).toBeVisible();
      await expect(pod(page, 'Pflanze 1')).toBeVisible();
      // The hardware of the other devices is for owners: not even the heading, and no way to add.
      await expect(page.getByRole('heading', { name: 'Neu erkannt' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Hinzufügen' })).toHaveCount(0);
      await expect(page.getByText('Pflanze 2')).toHaveCount(0);

      // A member can rename the device.
      await pod(page, 'Pflanze 1').getByRole('link').click();
      await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Pflanze 1');
      await page.getByRole('textbox', { name: 'Name' }).fill('Basilikum');
      // Exact: the card "Grenzwerte" has a button "Grenzwerte speichern" too.
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(heading(page, 'Basilikum')).toBeVisible();
      await page.goto('/geraete');
      await expect(pod(page, 'Basilikum')).toBeVisible();
      await expect(pod(page, 'Pflanze 1')).toHaveCount(0);
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
    const block = page.locator('ui-card').filter({ hasText: 'Simulator' });
    await expect(block).toContainText('Bridge: Online');
    await expect(block).toContainText('Zigbee2MQTT: Online');
    await expect(block).not.toContainText('Gesperrt am');
  });
});
