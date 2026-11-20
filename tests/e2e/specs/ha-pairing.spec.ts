import { expect, test, type Page } from '@playwright/test';
import type { MqttClient } from 'mqtt';
import { BASE_URL } from '../helpers/env';
import { connectAsHomeAssistant, PAIRING_CODE, redeemPairingCode } from '../helpers/ha-pairing';
import { inviteThroughApi } from '../helpers/households';

// The owner here is a person of its own with a household of its own, so the paired gateway and
// its hardware disturb no other spec: `devices.spec.ts` counts the hardware in "Neu erkannt" of
// its household. The budget of code requests is used up (see `accounts.ts`), so the person signs
// in without one: `smoke` invites it as a viewer into "Haus smoke" (whose members no spec looks
// at), it accepts as a new person and sets up "Haus Home Assistant", which becomes its current
// household. A helper then plays Home Assistant: it redeems the code at the app's address and
// connects through the web nginx (ws://…/mqtt), as the integration does.

const OWNER = { email: 'e2e-ha-owner@example.org', name: 'Eigentümer Home Assistant' };
const HOUSEHOLD = 'Haus Home Assistant';
/** The name Home Assistant sends when it redeems the code (its location name). */
const HOME_ASSISTANT = 'Home Assistant Teststand';
const ORIGIN = new URL(BASE_URL).origin;

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test('the owner pairs Home Assistant with a code and its lamp shows under "Neu erkannt"', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { link } = await inviteThroughApi('smoke', OWNER.email, 'viewer');
  const context = await browser.newContext({ storageState: undefined });
  let homeAssistant: MqttClient | undefined;
  try {
    const page = await context.newPage();

    await test.step('a new person joins and sets up a household of its own', async () => {
      await page.goto(link);
      await expect(page).toHaveURL(/\/einladung$/);
      await page.getByRole('textbox', { name: 'Dein Name' }).fill(OWNER.name);
      await page.getByRole('button', { name: 'Annehmen' }).click();
      await expect(heading(page, 'Übersicht')).toBeVisible();
      const created = await page.request.post('/api/v1/households', {
        headers: { Origin: ORIGIN },
        data: { name: HOUSEHOLD, timezone: 'Europe/Berlin' },
      });
      expect(created.status()).toBe(201);
    });

    const section = page
      .locator('ui-section')
      .filter({ has: page.getByRole('heading', { name: 'Home Assistant koppeln' }) });
    let code = '';
    await test.step('the owner creates a code', async () => {
      await page.goto('/mehr/gateways');
      await expect(heading(page, 'Gateways')).toBeVisible();
      await expect(page.locator('ui-top-app-bar')).toContainText(HOUSEHOLD);
      await section.getByRole('button', { name: 'Code erzeugen' }).click();
      await expect(section).toContainText(PAIRING_CODE);
      // The address to enter in Home Assistant is the app's own (APP_ORIGIN).
      await expect(section).toContainText(ORIGIN);
      code = PAIRING_CODE.exec(await section.innerText())?.[0] ?? '';
    });

    await test.step('Home Assistant redeems it and connects through the web nginx', async () => {
      const access = await redeemPairingCode(code, HOME_ASSISTANT);
      expect(access.mqttUrl).toBe(`${ORIGIN.replace(/^http/, 'ws')}/mqtt`);
      expect(access.clientId).toBe(`${access.gatewayId}-ha`);
      homeAssistant = await connectAsHomeAssistant(access);
    });

    await test.step('the page reports the connection and lists the paired gateway', async () => {
      // The page asks for the gateway list every 5 s while the code is shown.
      await expect(section).toContainText(`Verbunden: ${HOME_ASSISTANT}`, { timeout: 20_000 });
      const card = page.locator('ui-card').filter({ hasText: HOME_ASSISTANT });
      await expect(card).toContainText('Gekoppelt über Home Assistant');
      await expect(async () => {
        await page.reload();
        await expect(card).toContainText('Bridge: Online', { timeout: 3_000 });
        await expect(card).toContainText('Home Assistant: Online', { timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
    });

    await test.step('the lamp of Home Assistant shows under "Neu erkannt"', async () => {
      await page.goto('/geraete');
      await expect(heading(page, 'Geräte')).toBeVisible();
      const lamp = page
        .locator('ui-card')
        .filter({ has: page.getByRole('heading', { name: 'Neu erkannt' }) })
        .locator('form')
        .filter({ has: page.locator('ui-device-pod').filter({ hasText: 'Stehlampe' }) });
      await expect(async () => {
        await page.reload();
        await expect(lamp).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      await expect(lamp.getByRole('textbox', { name: 'Name' })).toHaveValue('Stehlampe');
    });
  } finally {
    await homeAssistant?.endAsync();
    await context.close();
  }
});
