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
  type Responder,
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
  /** Wraps the answers of the server, e.g. to make one of them slow. */
  wrap?: (respond: Responder) => Responder;
}

function open({
  household = owner,
  language = 'de',
  id = 'dev-1',
  wrap = (respond) => respond,
  ...initial
}: Options = {}) {
  TestBed.overrideProvider(UiClock, { useValue: { now: signal(NOW) } });
  const { state, respond } = devicesServer(household.id, { devices: [sensor], ...initial });
  const me: Me = meWith([household], household.id);
  return openHouseholdPage(routes, `/geraete/${id}`, {
    language,
    me,
    respond: wrap(respond),
  }).then((page) => Object.assign(page, { server: state }));
}

const gets = (page: OpenedHouseholdPage) =>
  page.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/devices/dev-1'));

describe('device page', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.setAttribute('lang', 'de');
  });

  describe('hero', () => {
    const hero = (page: OpenedHouseholdPage) => page.element.querySelector('ui-value-display');
    const meter = (page: OpenedHouseholdPage) =>
      page.element.querySelector<HTMLElement>('ui-progress-band');
    const pods = (page: OpenedHouseholdPage) =>
      [...page.element.querySelectorAll('ui-device-pod')].map((pod) =>
        pod.textContent?.replace(/\s+/g, ' ').trim(),
      );

    it('shows the main value large, with its name, status and when it was updated', async () => {
      const page = await open();
      await flush(page);
      expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('Basilikum');
      expect(pageText(page.element)).toContain('Pflanze');
      expect(hero(page)?.getAttribute('data-size')).toBe('hero');
      expect(hero(page)?.textContent).toContain('41,3');
      expect(hero(page)?.textContent).toContain('%');
      const text = pageText(page.element);
      expect(text).toContain('Bodenfeuchte');
      expect(text).toContain('trocken');
      expect(text).toContain('Aktualisiert vor 5 Minuten');
      expect(text).toContain('Acme SM-1');
      expect(gets(page)).toHaveLength(1);
    });

    it('marks the target range from the effective thresholds on a meter', async () => {
      const page = await open({
        devices: [
          {
            ...sensor,
            effectiveThresholds: { ...sensor.effectiveThresholds, soilMoistureMax: 60 },
          },
        ],
      });
      await flush(page);
      const band = meter(page)!;
      expect(band.getAttribute('role')).toBe('meter');
      expect(band.getAttribute('aria-valuenow')).toBe('41.26');
      expect(band.getAttribute('aria-label')).toBe('Bodenfeuchte');
      expect(band.getAttribute('aria-valuetext')).toBe(
        '41,3\u00a0%, im Zielbereich von 25 bis 60 Prozent.',
      );
      expect(band.querySelector('.band')?.getAttribute('data-tone')).toBe('ok-container');
      // 25 to 60 percent of the scale.
      expect(band.querySelector<HTMLElement>('.band')?.style.insetInlineStart).toBe('25%');
      expect(band.querySelector<HTMLElement>('.band')?.style.width).toBe('35%');
    });

    it('says in words that the soil is too dry', async () => {
      const page = await open({
        devices: [device('dev-1', 'Ficus', { state: { soil_moisture: 12, battery: 90 } })],
      });
      await flush(page);
      expect(meter(page)?.getAttribute('aria-valuetext')).toContain('zu trocken');
      expect(pageText(page.element)).toContain('trocken');
    });

    it('says in words that the soil is too wet', async () => {
      const page = await open({
        devices: [
          device('dev-1', 'Farn', {
            state: { soil_moisture: 85 },
            effectiveThresholds: { ...sensor.effectiveThresholds, soilMoistureMax: 70 },
          }),
        ],
      });
      await flush(page);
      expect(meter(page)?.getAttribute('aria-valuetext')).toContain('zu nass');
      expect(pageText(page.element)).toContain('nass');
    });

    it('shows the next readings as three pods, without a setting', async () => {
      const page = await open();
      await flush(page);
      expect(pods(page)).toEqual([
        expect.stringMatching(/21,5\s?°C\s?Temperatur$/),
        expect.stringMatching(/87\s?%\s?Batterie$/),
        expect.stringMatching(/120\s?Signalqualität$/),
      ]);
      expect(pageText(page.element)).not.toContain('soil_calibration');
    });

    it('has no meter for a device that is not a plant', async () => {
      const page = await open({
        devices: [
          device('dev-1', 'Fühler', {
            kind: 'climate',
            capabilities: [capability('temperature', { unit: '°C' }), capability('humidity')],
            state: { temperature: 21.5, humidity: 44 },
          }),
        ],
      });
      await flush(page);
      expect(meter(page)).toBeNull();
      expect(hero(page)?.textContent).toContain('21,5');
      expect(pageText(page.element)).toContain('Klimasensor');
      expect(pods(page)).toHaveLength(1);
    });

    it('speaks English', async () => {
      const page = await open({ language: 'en' });
      await flush(page);
      const text = pageText(page.element);
      expect(text).toContain('Soil moisture');
      expect(hero(page)?.textContent).toContain('41.3');
      expect(text).toContain('Updated 5 minutes ago');
      expect(text).toContain('Temperature');
      expect(meter(page)?.getAttribute('aria-valuetext')).toContain('within the target range');
    });

    it('shows a dash with a text for screen readers while a value is missing', async () => {
      const page = await open({
        devices: [device('dev-1', 'Neu', { state: {}, lastSeenAt: null })],
      });
      await flush(page);
      expect(hero(page)?.textContent).toContain('–');
      expect(page.element.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
        'noch keine Werte',
      );
      expect(pageText(page.element)).toContain('Noch nichts gemeldet');
      expect(meter(page)).toBeNull();
    });
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

  it.each([
    [10, 15, false],
    [30, 25, true],
    [20, 20, false],
  ])(
    'hints at a low battery by the own limit of the device (limit %i, battery %i)',
    async (batteryMin, level, hinted) => {
      const base = device('x', 'x').effectiveThresholds;
      const page = await open({
        devices: [
          device('dev-1', 'Garten', {
            state: { soil_moisture: 30, battery: level },
            effectiveThresholds: { ...base, batteryMin },
          }),
        ],
      });
      await flush(page);
      expect(pageText(page.element).includes('Die Batterie ist fast leer.')).toBe(hinted);
    },
  );

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
    const hero = (page: OpenedHouseholdPage) => page.element.querySelector('ui-value-display');
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
      expect(hero(page)?.textContent).toContain('55');
      expect(
        page.element.querySelector<HTMLInputElement>('ui-text-field[name="name"] input')?.value,
      ).toBe('Thymian');
    });

    it('does not let a refresh that was already on its way undo a rename', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let slowGets = 0;
      const page = await open({
        household: member,
        // The second GET is answered with the state of the moment it was asked, but late.
        wrap: (respond) => async (call) => {
          const answer = respond(call);
          if (call.method !== 'GET' || !call.path.endsWith('/devices/dev-1')) return answer;
          if (++slowGets < 2) return answer;
          await gate;
          return answer;
        },
      });
      await flush(page);
      await vi.advanceTimersByTimeAsync(60_500);
      expect(gets(page)).toHaveLength(2);
      typeInto(page, 'name', 'Thymian');
      await press(page, 'Speichern');
      expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('Thymian');
      release();
      await flush(page);
      expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('Thymian');
    });

    it('asks once when the tick and the tab coming back meet a slow refresh', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open();
      await flush(page);
      const release = page.hold();
      await vi.advanceTimersByTimeAsync(60_500);
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(gets(page)).toHaveLength(2);
      release();
      await flush(page);
      document.dispatchEvent(new Event('visibilitychange'));
      await flush(page);
      expect(gets(page)).toHaveLength(3);
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
