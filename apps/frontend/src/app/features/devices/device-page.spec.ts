import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Language, Me } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import { apiError, householdOf, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageButton,
  pageText,
  press,
  typeInto,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import { capability, device, devicesServer, type DevicesServer } from './devices-testing';
import { deviceRoutes } from './devices.routes';

const owner = householdOf('Home', { role: 'owner' });
const member = householdOf('Member', { role: 'member' });
const viewer = householdOf('Viewer', { role: 'viewer' });
const routes = [{ path: 'geraete/:id', loadChildren: () => deviceRoutes }];
const NOW = Date.parse('2026-10-14T12:00:00Z');

const sensor = device('dev-1', 'Basilikum', {
  capabilities: [
    ...device('x', 'x').capabilities,
    // The server leaves settings out; the page must not show one that slips through anyway.
    capability('soil_calibration', { isSetting: true }),
  ],
  state: {
    soil_moisture: 41.26,
    temperature: 21.5,
    battery: 87,
    linkquality: 120,
    dry: true,
    soil_calibration: 5,
  },
});

interface Options extends Partial<DevicesServer> {
  household?: typeof owner;
  language?: Language;
  id?: string;
}

function open({ household = owner, language = 'de', id = 'dev-1', ...initial }: Options = {}) {
  TestBed.overrideProvider(UiClock, { useValue: { now: signal(NOW) } });
  const { state, respond } = devicesServer(household.id, { devices: [sensor], ...initial });
  const me: Me = meWith([household], household.id);
  return openHouseholdPage(routes, `/geraete/${id}`, { language, me, respond }).then((page) =>
    Object.assign(page, { server: state }),
  );
}

const gets = (page: OpenedHouseholdPage) =>
  page.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/devices/dev-1'));

describe('device page', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.setAttribute('lang', 'de');
  });

  it('shows all readings with their units and no settings', async () => {
    const page = await open();
    await flush(page);
    expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('Basilikum');
    const text = pageText(page.element);
    expect(text).toContain('Bodenfeuchte: 41,3 %');
    expect(text).toContain('Temperatur: 21,5 °C');
    expect(text).toContain('Batterie: 87 %');
    expect(text).toContain('Signalqualität: 120');
    expect(text).toContain('Trocken: trocken');
    expect(text).toContain('Zuletzt gemeldet vor 5 Minuten');
    expect(text).toContain('Acme SM-1');
    expect(text).not.toContain('soil_calibration');
    expect(gets(page)).toHaveLength(1);
  });

  it('shows the readings in English', async () => {
    const page = await open({ language: 'en' });
    await flush(page);
    const text = pageText(page.element);
    expect(text).toContain('Soil moisture: 41.3 %');
    expect(text).toContain('Dry: dry');
    expect(text).toContain('Last reported 5 minutes ago');
  });

  it('shows a dash with a text for screen readers while a value is missing', async () => {
    const page = await open({ devices: [device('dev-1', 'Neu', { state: {}, lastSeenAt: null })] });
    await flush(page);
    expect(pageText(page.element)).toContain('Bodenfeuchte: –');
    expect(page.element.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'noch keine Werte',
    );
  });

  it('hints at an offline device and a low battery', async () => {
    const page = await open({
      devices: [
        device('dev-1', 'Garten', {
          availability: 'offline',
          state: { soil_moisture: 30, battery: 15 },
        }),
      ],
    });
    await flush(page);
    const text = pageText(page.element);
    expect(text).toContain('Offline – angezeigt wird der letzte bekannte Stand.');
    expect(text).toContain('Die Batterie ist fast leer.');
  });

  it('says so when the device does not exist, without a message or a reload of the access', async () => {
    const page = await open({ id: 'gone' });
    await flush(page);
    expect(pageText(page.element)).toContain('Gerät nicht gefunden');
    expect(page.snackbar.show).not.toHaveBeenCalled();
    expect(page.calls.filter((call) => call.path === '/api/v1/me')).toHaveLength(1);
  });

  describe('rename', () => {
    it('lets a member rename the device', async () => {
      const page = await open({ household: member });
      await flush(page);
      const field = page.element.querySelector<HTMLInputElement>(
        'ui-text-field[name="name"] input',
      );
      expect(field?.value).toBe('Basilikum');
      typeInto(page, 'name', 'Thymian');
      await press(page, 'Speichern');
      const patches = page.calls.filter((call) => call.method === 'PATCH');
      expect(patches).toHaveLength(1);
      expect(patches[0]!.path).toBe(`/api/v1/households/${member.id}/devices/dev-1`);
      expect(patches[0]!.body).toEqual({ name: 'Thymian' });
      expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('Thymian');
    });

    it('does not send an empty name', async () => {
      const page = await open({ household: owner });
      await flush(page);
      typeInto(page, 'name', '  ');
      await press(page, 'Speichern');
      expect(page.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
      expect(pageText(page.element)).toContain('Bitte gib einen Namen');
    });

    it('offers no renaming to a viewer', async () => {
      const page = await open({ household: viewer });
      await flush(page);
      expect(pageButton(page.element, 'Speichern')).toBeUndefined();
      expect(page.element.querySelector('ui-text-field')).toBeNull();
    });

    it('reports a refused rename', async () => {
      const page = await open({
        household: member,
        fail: (call) => (call.method === 'PATCH' ? apiError('validation.failed', 400) : undefined),
      });
      await flush(page);
      typeInto(page, 'name', 'Thymian');
      await press(page, 'Speichern');
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Die Eingabe ist ungültig.',
        expect.anything(),
      );
    });
  });

  describe('refresh', () => {
    const visibility = (state: DocumentVisibilityState) =>
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);

    it('loads again after 60 seconds and keeps what was typed', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ household: member });
      await flush(page);
      typeInto(page, 'name', 'Thymian');
      page.server.devices = [{ ...sensor, state: { ...sensor.state, soil_moisture: 55 } }];
      await vi.advanceTimersByTimeAsync(59_000);
      expect(gets(page)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_500);
      await flush(page);
      expect(gets(page)).toHaveLength(2);
      expect(pageText(page.element)).toContain('Bodenfeuchte: 55 %');
      expect(
        page.element.querySelector<HTMLInputElement>('ui-text-field[name="name"] input')?.value,
      ).toBe('Thymian');
    });

    it('does not load while the tab is hidden', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open();
      await flush(page);
      visibility('hidden');
      await vi.advanceTimersByTimeAsync(180_000);
      await flush(page);
      expect(gets(page)).toHaveLength(1);
      visibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await flush(page);
      expect(gets(page)).toHaveLength(2);
    });
  });
});
