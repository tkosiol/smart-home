import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { effectiveThresholds, type Device, type Language, type Me } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import { apiError, householdOf, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageButton,
  pageText,
  press,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import { battery, capability, device, devicesServer, type DevicesServer } from './devices-testing';
import { deviceRoutes } from './devices.routes';

const owner = householdOf('Home', { role: 'owner' });
const member = householdOf('Member', { role: 'member' });
const viewer = householdOf('Viewer', { role: 'viewer' });
const routes = [{ path: 'geraete/:id', loadChildren: () => deviceRoutes }];

const plant = device('dev-1', 'Basilikum');
/** A plant that has its own lower limit; the effective values follow the contract. */
const customised = (own: Device['thresholds']): Device => ({
  ...plant,
  thresholds: own,
  effectiveThresholds: effectiveThresholds('soil', own),
});

interface Options extends Partial<DevicesServer> {
  household?: typeof owner;
  language?: Language;
}

async function open({ household = owner, language = 'de', ...initial }: Options = {}) {
  TestBed.overrideProvider(UiClock, {
    useValue: { now: signal(Date.parse('2026-10-14T12:00:00Z')) },
  });
  const { state, respond } = devicesServer(household.id, { devices: [plant], ...initial });
  const me: Me = meWith([household], household.id);
  const page = await openHouseholdPage(routes, '/geraete/dev-1', { language, me, respond });
  await flush(page);
  return Object.assign(page, { server: state });
}

const card = (page: OpenedHouseholdPage) =>
  page.element.querySelector<HTMLElement>('app-thresholds-card')!;
const cardText = (page: OpenedHouseholdPage) => pageText(card(page));
const field = (page: OpenedHouseholdPage, key: string) =>
  page.element.querySelector<HTMLInputElement>(
    `app-thresholds-card ui-text-field input[name="${key}"]`,
  );
const fields = (page: OpenedHouseholdPage) =>
  [...card(page).querySelectorAll('ui-text-field input')].map((field) =>
    field.getAttribute('name'),
  );
const patches = (page: OpenedHouseholdPage) => page.calls.filter((call) => call.method === 'PATCH');

function type(page: OpenedHouseholdPage, key: string, value: string) {
  const input = field(page, key)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  page.harness.detectChanges();
}
const save = (page: OpenedHouseholdPage) => press(page, 'Grenzwerte speichern');

describe('thresholds card', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.setAttribute('lang', 'de');
  });

  describe('fields', () => {
    it('shows the values of a plant sensor that has a battery', async () => {
      const page = await open();
      expect(fields(page)).toEqual([
        'soilMoistureMin',
        'soilMoistureMax',
        'batteryMin',
        'silentMinutes',
      ]);
      expect(cardText(page)).toContain('Grenzwerte');
      expect(cardText(page)).not.toContain('Offen länger als');
      // The values in force: the kind's defaults. No upper limit means an empty field.
      expect(field(page, 'soilMoistureMin')?.value).toBe('25');
      expect(field(page, 'soilMoistureMax')?.value).toBe('');
      expect(field(page, 'batteryMin')?.value).toBe('20');
      expect(field(page, 'silentMinutes')?.value).toBe('120');
    });

    it('leaves out the moisture and the battery for a lamp', async () => {
      const lamp = device('dev-1', 'Lampe', {
        kind: 'light',
        capabilities: [capability('state', { kind: 'binary', writable: true })],
        state: { state: 'ON' },
        effectiveThresholds: effectiveThresholds('light', {}),
      });
      const page = await open({ devices: [lamp] });
      expect(fields(page)).toEqual(['silentMinutes']);
    });

    it('shows how long a contact may be open, and the battery', async () => {
      const window = device('dev-1', 'Fenster', {
        kind: 'contact',
        capabilities: [capability('contact', { kind: 'binary' }), battery],
        state: { contact: false, battery: 80 },
        effectiveThresholds: effectiveThresholds('contact', {}),
      });
      const page = await open({ devices: [window] });
      expect(fields(page)).toEqual(['batteryMin', 'contactOpenMinutes', 'silentMinutes']);
      expect(field(page, 'contactOpenMinutes')?.value).toBe('10');
      expect(cardText(page)).not.toContain('Feuchte');
    });

    it('marks what is the standard and what is customised, with the standard', async () => {
      const page = await open({
        devices: [customised({ soilMoistureMin: 30, soilMoistureMax: 70 })],
      });
      // The state of each value, in the order of the fields; battery and silence stay the kind's.
      const states = [...card(page).querySelectorAll('ui-status-chip')].map((chip) =>
        chip.textContent?.trim(),
      );
      expect(states).toEqual([
        'Angepasst (Standard: 25 %)',
        'Angepasst (Standard: aus)',
        'Standard',
        'Standard',
      ]);
      expect(field(page, 'soilMoistureMin')?.value).toBe('30');
      expect(field(page, 'soilMoistureMax')?.value).toBe('70');
    });

    it('speaks English', async () => {
      const page = await open({ language: 'en', devices: [customised({ soilMoistureMin: 30 })] });
      const text = cardText(page);
      expect(text).toContain('Thresholds');
      expect(text).toContain('Moisture lower limit (%)');
      expect(text).toContain('Customised (standard: 25 %)');
      expect(pageButton(card(page), 'Save thresholds')).toBeDefined();
      expect(pageButton(card(page), 'Reset to standard')).toBeDefined();
    });
  });

  describe('changing', () => {
    it('sends only the value that was changed, as a number', async () => {
      const page = await open();
      type(page, 'soilMoistureMin', '30');
      await save(page);
      expect(patches(page)).toHaveLength(1);
      expect(patches(page)[0]!.path).toBe(`/api/v1/households/${owner.id}/devices/dev-1`);
      expect(patches(page)[0]!.body).toEqual({ thresholds: { soilMoistureMin: 30 } });
      // The answer of the server is what the card shows now.
      expect(cardText(page)).toContain('Angepasst (Standard: 25 %)');
      expect(field(page, 'soilMoistureMin')?.value).toBe('30');
    });

    it('sends several values at once and takes a comma as the decimal separator', async () => {
      const page = await open();
      type(page, 'soilMoistureMin', '30,5');
      type(page, 'soilMoistureMax', '70');
      type(page, 'silentMinutes', '60');
      await save(page);
      expect(patches(page)[0]!.body).toEqual({
        thresholds: { soilMoistureMin: 30.5, soilMoistureMax: 70, silentMinutes: 60 },
      });
    });

    it('lets a member change the values', async () => {
      const page = await open({ household: member });
      type(page, 'batteryMin', '15');
      await save(page);
      expect(patches(page)[0]!.body).toEqual({ thresholds: { batteryMin: 15 } });
    });

    it('sends nothing when nothing changed', async () => {
      const page = await open();
      await save(page);
      type(page, 'soilMoistureMin', '25');
      await save(page);
      expect(patches(page)).toHaveLength(0);
    });

    it('sends null for a field that was emptied, which means the standard', async () => {
      const page = await open({ devices: [customised({ soilMoistureMax: 70 })] });
      type(page, 'soilMoistureMax', '');
      await save(page);
      expect(patches(page)[0]!.body).toEqual({ thresholds: { soilMoistureMax: null } });
      expect(cardText(page)).not.toContain('Angepasst');
    });

    it('keeps what was typed when the device is fetched again', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open();
      type(page, 'soilMoistureMin', '33');
      expect(field(page, 'soilMoistureMin')?.value).toBe('33');
      await vi.advanceTimersByTimeAsync(60_500);
      await flush(page);
      expect(field(page, 'soilMoistureMin')?.value).toBe('33');
    });
  });

  describe('errors', () => {
    it.each(['abc', '-5', '101', '1e2'])('refuses "%s" before it is sent', async (text) => {
      const page = await open();
      type(page, 'batteryMin', text);
      await save(page);
      expect(patches(page)).toHaveLength(0);
      expect(cardText(page)).toContain('Bitte gib eine gültige Zahl ein');
      expect(field(page, 'batteryMin')?.getAttribute('aria-invalid')).toBe('true');
      expect(field(page, 'soilMoistureMin')?.getAttribute('aria-invalid')).toBe('false');
    });

    it('refuses minutes that are not whole', async () => {
      const page = await open();
      type(page, 'silentMinutes', '1,5');
      await save(page);
      expect(patches(page)).toHaveLength(0);
      expect(cardText(page)).toContain('Bitte gib eine gültige Zahl ein');
    });

    it('refuses a lower moisture limit at or above the upper one, as the server does', async () => {
      const page = await open({ devices: [customised({ soilMoistureMax: 60 })] });
      type(page, 'soilMoistureMin', '60');
      await save(page);
      expect(patches(page)).toHaveLength(0);
      expect(cardText(page)).toContain('Die untere Feuchte muss unter der oberen liegen.');
      expect(field(page, 'soilMoistureMin')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('measures a new upper limit against the standard lower one', async () => {
      const page = await open();
      type(page, 'soilMoistureMax', '20');
      await save(page);
      expect(patches(page)).toHaveLength(0);
      expect(field(page, 'soilMoistureMax')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('clears an error when the user types again', async () => {
      const page = await open();
      type(page, 'batteryMin', 'abc');
      await save(page);
      type(page, 'batteryMin', '15');
      expect(cardText(page)).not.toContain('Bitte gib eine gültige Zahl ein');
    });

    it('shows a refusal by the server (400) at the fields that were sent', async () => {
      const page = await open({
        fail: (call) => (call.method === 'PATCH' ? apiError('validation.failed', 400) : undefined),
      });
      type(page, 'soilMoistureMin', '30');
      await save(page);
      expect(patches(page)).toHaveLength(1);
      expect(cardText(page)).toContain('Dieser Wert wurde abgelehnt');
      expect(field(page, 'soilMoistureMin')?.getAttribute('aria-invalid')).toBe('true');
      expect(field(page, 'batteryMin')?.getAttribute('aria-invalid')).toBe('false');
      // A field error is enough; no snackbar on top.
      expect(page.snackbar.show).not.toHaveBeenCalled();
      // What was typed stays, so it can be corrected.
      expect(field(page, 'soilMoistureMin')?.value).toBe('30');
    });

    it('reports another failure in the snackbar', async () => {
      const page = await open({
        fail: (call) => (call.method === 'PATCH' ? apiError('internal', 500) : undefined),
      });
      type(page, 'soilMoistureMin', '30');
      await save(page);
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Etwas ist schiefgegangen. Bitte versuche es später noch einmal.',
        expect.anything(),
      );
      expect(cardText(page)).not.toContain('Dieser Wert wurde abgelehnt');
    });
  });

  describe('reset', () => {
    it('sets every customised value back to the standard with null', async () => {
      const page = await open({
        devices: [customised({ soilMoistureMin: 30, batteryMin: 10 })],
      });
      expect(cardText(page)).toContain('Angepasst');
      await press(page, 'Auf Standard zurücksetzen');
      expect(patches(page)).toHaveLength(1);
      expect(patches(page)[0]!.body).toEqual({
        thresholds: { soilMoistureMin: null, batteryMin: null },
      });
      expect(cardText(page)).not.toContain('Angepasst');
      expect(field(page, 'soilMoistureMin')?.value).toBe('25');
      expect(field(page, 'batteryMin')?.value).toBe('20');
      // Nothing is left to reset.
      expect(pageButton(card(page), 'Auf Standard zurücksetzen')).toBeUndefined();
    });

    it('is offered only while a value is customised', async () => {
      const page = await open();
      expect(pageButton(card(page), 'Auf Standard zurücksetzen')).toBeUndefined();
    });

    it('reports a failure of the reset', async () => {
      const page = await open({
        devices: [customised({ soilMoistureMin: 30 })],
        fail: (call) => (call.method === 'PATCH' ? apiError('internal', 500) : undefined),
      });
      await press(page, 'Auf Standard zurücksetzen');
      expect(page.snackbar.show).toHaveBeenCalled();
      expect(cardText(page)).toContain('Angepasst');
    });
  });

  describe('a viewer', () => {
    it('sees the values and whether they are customised, without controls', async () => {
      const page = await open({
        household: viewer,
        devices: [customised({ soilMoistureMin: 30 })],
      });
      expect(
        card(page).querySelector('input, button, ui-text-field, form [type="submit"]'),
      ).toBeNull();
      // Label and value of each row (the parts have no space between them in the DOM).
      const rows = [...card(page).querySelectorAll('ui-list-item')].map((row) =>
        ['.headline', '.trailing'].map((part) => row.querySelector(part)?.textContent?.trim()),
      );
      expect(rows).toEqual([
        ['Feuchte unten', expect.stringMatching(/^30\s%$/)],
        ['Feuchte oben', 'aus'],
        ['Batterie unter', expect.stringMatching(/^20\s%$/)],
        ['Stumm nach', '120 Minuten'],
      ]);
      const text = cardText(page);
      expect(text).toContain('Angepasst (Standard: 25 %)');
      expect(text).not.toContain('Grenzwerte speichern');
      expect(text).not.toContain('Auf Standard zurücksetzen');
    });
  });
});
