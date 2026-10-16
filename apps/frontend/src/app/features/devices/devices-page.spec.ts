import { TestBed } from '@angular/core/testing';
import type { Language, Me } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import { signal } from '@angular/core';
import { apiError, householdOf, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageText,
  press,
  typeInto,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import {
  battery,
  device,
  devicesServer,
  hardware,
  linkquality,
  type DevicesServer,
} from './devices-testing';
import { devicesRoutes } from './devices.routes';

const home = householdOf('Home', { role: 'owner' });
const member = householdOf('Member', { role: 'member' });
const NOW = Date.parse('2026-10-14T12:00:00Z');
const routes = [{ path: 'geraete', loadChildren: () => devicesRoutes }];

interface Options extends Partial<DevicesServer> {
  household?: typeof home;
  language?: Language;
}

function open({ household = home, language = 'de', ...initial }: Options = {}) {
  TestBed.overrideProvider(UiClock, { useValue: { now: signal(NOW) } });
  const { state, respond } = devicesServer(household.id, initial);
  const me: Me = meWith([household], household.id);
  return openHouseholdPage(routes, '/geraete', { language, me, respond }).then((page) =>
    Object.assign(page, { server: state }),
  );
}

const cards = (page: OpenedHouseholdPage) =>
  [...page.element.querySelectorAll('app-device-card')] as HTMLElement[];
const cardText = (page: OpenedHouseholdPage, name: string) =>
  pageText(cards(page).find((card) => card.querySelector('h3')?.textContent?.trim() === name)!);
const requests = (page: OpenedHouseholdPage, method: string, path: string) =>
  page.calls.filter((call) => call.method === method && call.path.endsWith(path));

const sensor = device('dev-1', 'Basilikum');
const newSensor = hardware('aaaa', 'Zigbee Sensor 7');

describe('devices page', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.setAttribute('lang', 'de');
  });

  it.each([
    ['de', 'Geräte', 'Noch keine Geräte'],
    ['en', 'Devices', 'No devices yet'],
  ] as const)('shows its title and empty state in %s', async (language, title, heading) => {
    const page = await open({ language });
    await flush(page);
    expect(page.element.querySelector('h1')?.textContent?.trim()).toBe(title);
    expect(page.element.querySelector('ui-empty-state h2')?.textContent?.trim()).toBe(heading);
  });

  describe('list', () => {
    it('shows the main value, the battery and when the device last reported', async () => {
      const page = await open({ devices: [sensor] });
      await flush(page);
      expect(page.calls.filter((call) => call.path.endsWith('/devices'))).toHaveLength(1);
      const text = cardText(page, 'Basilikum');
      expect(text).toContain('Bodenfeuchte: 41,3 %');
      expect(text).toContain('Batterie: 87 %');
      expect(text).toContain('Zuletzt gemeldet vor 5 Minuten');
      expect(text).not.toContain('Offline');
      expect(text).not.toContain('Batterie ist fast leer');
      const link = cards(page)[0]!.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/geraete/dev-1');
    });

    it('formats the values in the page language', async () => {
      const page = await open({ devices: [sensor], language: 'en' });
      await flush(page);
      expect(cardText(page, 'Basilikum')).toContain('Soil moisture: 41.3 %');
      expect(cardText(page, 'Basilikum')).toContain('Last reported 5 minutes ago');
    });

    it('says "noch keine Werte" for a device without values', async () => {
      const empty = device('dev-2', 'Neu', { state: {}, lastSeenAt: null });
      const page = await open({ devices: [empty] });
      await flush(page);
      const text = cardText(page, 'Neu');
      expect(text).toContain('Bodenfeuchte: –');
      expect(text).toContain('Noch nichts gemeldet');
      const dash = cards(page)[0]!.querySelector('[role="img"]');
      expect(dash?.getAttribute('aria-label')).toBe('noch keine Werte');
    });

    it('points out that an offline device shows its last known state', async () => {
      const offline = device('dev-3', 'Garten', { availability: 'offline' });
      const page = await open({ devices: [sensor, offline] });
      await flush(page);
      expect(cardText(page, 'Garten')).toContain(
        'Offline – angezeigt wird der letzte bekannte Stand.',
      );
      expect(cardText(page, 'Basilikum')).not.toContain('Offline');
    });

    it('warns below 20 percent battery, not at 20', async () => {
      const low = device('dev-4', 'Schwach', { state: { soil_moisture: 30, battery: 15 } });
      const edge = device('dev-5', 'Grenze', { state: { soil_moisture: 30, battery: 20 } });
      const page = await open({ devices: [low, edge] });
      await flush(page);
      expect(cardText(page, 'Schwach')).toContain('Batterie: 15 %');
      expect(cardText(page, 'Schwach')).toContain(
        'Die Batterie ist fast leer. Bitte bald wechseln.',
      );
      expect(cardText(page, 'Grenze')).not.toContain('fast leer');
    });

    it('warns by the own battery threshold of the device, not a fixed 20 percent', async () => {
      const own = (batteryMin: number) => ({
        ...device('x', 'x').effectiveThresholds,
        batteryMin,
      });
      const lenient = device('dev-7', 'Gelassen', {
        state: { soil_moisture: 30, battery: 15 },
        effectiveThresholds: own(10),
      });
      const strict = device('dev-8', 'Streng', {
        state: { soil_moisture: 30, battery: 25 },
        effectiveThresholds: own(30),
      });
      const page = await open({ devices: [lenient, strict] });
      await flush(page);
      expect(cardText(page, 'Gelassen')).not.toContain('fast leer');
      expect(cardText(page, 'Streng')).toContain('Die Batterie ist fast leer');
    });

    it('shows a main value for a device with unknown keys by their raw key', async () => {
      const odd = device('dev-6', 'Seltsam', {
        capabilities: [{ ...linkquality, key: 'pm25', unit: 'µg/m³' }, battery],
        state: { pm25: 12, battery: 90 },
      });
      const page = await open({ devices: [odd] });
      await flush(page);
      expect(cardText(page, 'Seltsam')).toContain('pm25: 12 µg/m³');
    });
  });

  describe('new hardware', () => {
    it('shows an owner what was found, with the name prefilled and only readings as preview', async () => {
      const page = await open({ hardware: [newSensor] });
      await flush(page);
      const section = page.element.querySelector('app-new-hardware')!;
      expect(pageText(section as HTMLElement)).toContain('Neu erkannt');
      expect(pageText(section as HTMLElement)).toContain('Zigbee Sensor 7');
      expect(pageText(section as HTMLElement)).toContain('Bodenfeuchte: 37 %');
      expect(pageText(section as HTMLElement)).not.toContain('soil_calibration');
      expect(pageText(section as HTMLElement)).not.toContain('identify');
      expect(
        section.querySelector<HTMLInputElement>('ui-text-field[name="name"] input')?.value,
      ).toBe('Zigbee Sensor 7');
    });

    it('adds it as a device under the chosen name', async () => {
      const page = await open({ hardware: [newSensor] });
      await flush(page);
      typeInto(page, 'name', 'Basilikum');
      await press(page, 'Hinzufügen');
      const posts = requests(page, 'POST', '/devices');
      expect(posts).toHaveLength(1);
      expect(posts[0]!.body).toEqual({ hardwareId: 'aaaa', name: 'Basilikum' });
      expect(page.element.querySelector('app-new-hardware ui-section')).toBeNull();
      expect(cardText(page, 'Basilikum')).toContain('Bodenfeuchte');
      expect(requests(page, 'GET', '/devices').length).toBeGreaterThanOrEqual(2);
    });

    it('adds it under the hardware name when the name is left alone', async () => {
      const page = await open({ hardware: [newSensor] });
      await flush(page);
      await press(page, 'Hinzufügen');
      expect(requests(page, 'POST', '/devices')[0]!.body).toEqual({
        hardwareId: 'aaaa',
        name: 'Zigbee Sensor 7',
      });
    });

    it('does not send an empty name', async () => {
      const page = await open({ hardware: [newSensor] });
      await flush(page);
      typeInto(page, 'name', '   ');
      await press(page, 'Hinzufügen');
      expect(requests(page, 'POST', '/devices')).toHaveLength(0);
      expect(pageText(page.element)).toContain('Bitte gib einen Namen');
    });

    it('refreshes the list when the hardware was taken meanwhile', async () => {
      const page = await open({
        hardware: [newSensor],
        fail: (call) =>
          call.method === 'POST' ? apiError('device.hardwareBound', 409) : undefined,
      });
      await flush(page);
      page.server.hardware = [];
      await press(page, 'Hinzufügen');
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Diese Hardware ist bereits einem Gerät zugeordnet.',
        expect.anything(),
      );
      expect(page.element.querySelector('app-new-hardware ui-section')).toBeNull();
    });

    it('is not shown to a member, who does not even ask for it', async () => {
      const page = await open({ household: member, hardware: [newSensor], devices: [sensor] });
      await flush(page);
      expect(page.element.querySelector('app-new-hardware')).toBeNull();
      expect(pageText(page.element)).not.toContain('Neu erkannt');
      expect(page.calls.some((call) => call.path.includes('/hardware'))).toBe(false);
      expect(cardText(page, 'Basilikum')).toBeTruthy();
    });
  });

  describe('refresh', () => {
    const visibility = (state: DocumentVisibilityState) =>
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);

    it('loads again every 60 seconds while the tab is visible', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ devices: [sensor] });
      await flush(page);
      expect(requests(page, 'GET', '/devices')).toHaveLength(1);
      page.server.devices = [{ ...sensor, state: { ...sensor.state, soil_moisture: 55 } }];
      await vi.advanceTimersByTimeAsync(59_000);
      expect(requests(page, 'GET', '/devices')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_500);
      await flush(page);
      expect(requests(page, 'GET', '/devices')).toHaveLength(2);
      expect(cardText(page, 'Basilikum')).toContain('Bodenfeuchte: 55 %');
    });

    it('does not load while the tab is hidden, and does when it comes back', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ devices: [sensor] });
      await flush(page);
      visibility('hidden');
      await vi.advanceTimersByTimeAsync(180_000);
      await flush(page);
      expect(requests(page, 'GET', '/devices')).toHaveLength(1);
      visibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await flush(page);
      expect(requests(page, 'GET', '/devices')).toHaveLength(2);
    });

    it('asks once when the tick and the tab coming back meet a slow refresh', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ devices: [sensor], hardware: [newSensor] });
      await flush(page);
      const release = page.hold();
      await vi.advanceTimersByTimeAsync(60_500);
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(requests(page, 'GET', '/devices')).toHaveLength(2);
      expect(requests(page, 'GET', '/hardware?state=unassigned')).toHaveLength(2);
      release();
      await flush(page);
      document.dispatchEvent(new Event('visibilitychange'));
      await flush(page);
      expect(requests(page, 'GET', '/devices')).toHaveLength(3);
    });

    it('keeps the values and stays quiet when a refresh finds no connection', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ devices: [sensor] });
      await flush(page);
      page.server.fail = () => {
        throw new TypeError('offline');
      };
      await vi.advanceTimersByTimeAsync(60_500);
      await flush(page);
      expect(page.snackbar.show).not.toHaveBeenCalled();
      expect(cardText(page, 'Basilikum')).toContain('Bodenfeuchte: 41,3');
    });
  });
});
