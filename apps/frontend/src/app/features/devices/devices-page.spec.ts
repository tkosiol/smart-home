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
  notice,
  type DevicesServer,
} from './devices-testing';
import { devicesRoutes } from './devices.routes';
import type { Responder } from '../../testing/household-page-testing';

const home = householdOf('Home', { role: 'owner' });
const member = householdOf('Member', { role: 'member' });
const NOW = Date.parse('2026-10-14T12:00:00Z');
const routes = [{ path: 'geraete', loadChildren: () => devicesRoutes }];

interface Options extends Partial<DevicesServer> {
  wrap?: (respond: Responder) => Responder;
  household?: typeof home;
  language?: Language;
}

function open({
  household = home,
  language = 'de',
  wrap = (respond) => respond,
  ...initial
}: Options = {}) {
  TestBed.overrideProvider(UiClock, { useValue: { now: signal(NOW) } });
  const { state, respond } = devicesServer(household.id, initial);
  const me: Me = meWith([household], household.id);
  return openHouseholdPage(routes, '/geraete', { language, me, respond: wrap(respond) }).then(
    (page) => Object.assign(page, { server: state }),
  );
}

/** The pods of the list "Geräte im Haushalt" (the found hardware shows pods in its card, not here). */
const pods = (page: OpenedHouseholdPage) =>
  [...page.element.querySelectorAll('ui-section ui-device-pod')] as HTMLElement[];
const podOf = (page: OpenedHouseholdPage, name: string) =>
  pods(page).find((pod) => pod.textContent?.includes(name))!;
const podText = (page: OpenedHouseholdPage, name: string) => pageText(podOf(page, name));
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
    it('shows every device as a pod with its main value that links to its page', async () => {
      const page = await open({ devices: [sensor] });
      await flush(page);
      expect(page.calls.filter((call) => call.path.endsWith('/devices'))).toHaveLength(1);
      const text = podText(page, 'Basilikum');
      expect(text).toContain('41,3%');
      expect(text).not.toContain('Offline');
      expect(text).not.toContain('Batterie');
      const link = podOf(page, 'Basilikum').querySelector('a');
      expect(link?.getAttribute('href')).toBe('/geraete/dev-1');
    });

    it('formats the values in the page language', async () => {
      const page = await open({ devices: [sensor], language: 'en' });
      await flush(page);
      expect(podText(page, 'Basilikum')).toContain('41.3%');
    });

    it('shows a dash for a device without values', async () => {
      const empty = device('dev-2', 'Neu', { state: {}, lastSeenAt: null });
      const page = await open({ devices: [empty] });
      await flush(page);
      expect(podText(page, 'Neu')).toContain('–');
    });

    it('marks an offline device with the chip "Offline"', async () => {
      const offline = device('dev-3', 'Garten', { availability: 'offline' });
      const page = await open({ devices: [sensor, offline] });
      await flush(page);
      expect(podText(page, 'Garten')).toContain('Offline');
      expect(podText(page, 'Basilikum')).not.toContain('Offline');
    });

    it('marks a low battery only for a device with a battery_low item', async () => {
      const low = device('dev-4', 'Schwach', { state: { soil_moisture: 30, battery: 15 } });
      const fine = device('dev-5', 'Gut', { state: { soil_moisture: 30, battery: 15 } });
      const attention = [notice('battery_low', 'dev-4')];
      const page = await open({ devices: [low, fine], attention });
      await flush(page);
      expect(podText(page, 'Schwach')).toContain('Batterie');
      expect(podText(page, 'Gut')).not.toContain('Batterie');
    });

    it('shows no OK chip until the attention list is there, then the chip', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const page = await open({
        devices: [device('dev-4', 'Feucht', { state: { soil_moisture: 26 } })],
        attention: [notice('soil_dry', 'dev-4', 26)],
        wrap: (respond) => async (call) => {
          const answer = respond(call);
          if (call.method === 'GET' && call.path.endsWith('/attention')) await gate;
          return answer;
        },
      });
      await flush(page);
      expect(podText(page, 'Feucht')).toContain('26');
      expect(podText(page, 'Feucht')).not.toContain('OK');
      expect(podText(page, 'Feucht')).not.toContain('trocken');
      release();
      await flush(page);
      expect(podText(page, 'Feucht')).toContain('trocken');
    });

    it('stays without a chip when the attention list fails, and fills in on attention.changed', async () => {
      const page = await open({
        devices: [device('dev-4', 'Feucht', { state: { soil_moisture: 26 } })],
        fail: (call) =>
          call.path.endsWith('/attention') ? new Response(null, { status: 500 }) : undefined,
      });
      await flush(page);
      expect(podText(page, 'Feucht')).not.toContain('OK');
      page.live.emit('attention.changed', { items: [] });
      await flush(page);
      expect(podText(page, 'Feucht')).toContain('OK');
    });

    it('says dry for 26 % with an open soil_dry item, and not for 24 % without one', async () => {
      const held = device('dev-4', 'Gehalten', { state: { soil_moisture: 26 } });
      const below = device('dev-5', 'Darunter', { state: { soil_moisture: 24 } });
      const attention = [notice('soil_dry', 'dev-4', 26)];
      const page = await open({ devices: [held, below], attention });
      await flush(page);
      expect(podText(page, 'Gehalten')).toContain('trocken');
      expect(podText(page, 'Darunter')).not.toContain('trocken');
      expect(podText(page, 'Darunter')).toContain('OK');
    });

    it('shows the main value of a device with unknown keys', async () => {
      const odd = device('dev-6', 'Seltsam', {
        capabilities: [{ ...linkquality, key: 'pm25', unit: 'µg/m³' }, battery],
        state: { pm25: 12, battery: 90 },
      });
      const page = await open({ devices: [odd] });
      await flush(page);
      expect(podText(page, 'Seltsam')).toContain('12µg/m³');
    });
  });

  describe('new hardware', () => {
    it('shows an owner what was found, with the name prefilled and only readings as preview', async () => {
      const page = await open({ hardware: [newSensor] });
      await flush(page);
      const section = page.element.querySelector('app-new-hardware')!;
      expect(pageText(section as HTMLElement)).toContain('Neu erkannt');
      expect(pageText(section as HTMLElement)).toContain('Zigbee Sensor 7');
      expect(pageText(section.querySelector('ui-device-pod') as HTMLElement)).toContain('37%');
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
      expect(page.element.querySelector('app-new-hardware ui-card')).toBeNull();
      expect(podOf(page, 'Basilikum')).toBeTruthy();
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
      expect(page.element.querySelector('app-new-hardware ui-card')).toBeNull();
    });

    it('is not shown to a member, who does not even ask for it', async () => {
      const page = await open({ household: member, hardware: [newSensor], devices: [sensor] });
      await flush(page);
      expect(page.element.querySelector('app-new-hardware')).toBeNull();
      expect(pageText(page.element)).not.toContain('Neu erkannt');
      expect(page.calls.some((call) => call.path.includes('/hardware'))).toBe(false);
      expect(podText(page, 'Basilikum')).toBeTruthy();
    });
  });

  describe('live', () => {
    it('shows a device event: a changed value and a new device', async () => {
      const page = await open({ devices: [sensor] });
      await flush(page);
      page.live.emit('device.state', { ...sensor, state: { ...sensor.state, soil_moisture: 55 } });
      await flush(page);
      expect(podText(page, 'Basilikum')).toContain('55%');
      page.live.emit('device.state', device('dev-2', 'Minze'));
      await flush(page);
      expect(podText(page, 'Minze')).toBeTruthy();
      expect(requests(page, 'GET', '/devices')).toHaveLength(1);
    });

    it('updates the chip when attention.changed arrives, without a reload', async () => {
      const damp = device('dev-4', 'Feucht', { state: { soil_moisture: 26 } });
      const page = await open({ devices: [damp] });
      await flush(page);
      expect(podText(page, 'Feucht')).not.toContain('trocken');
      page.live.emit('attention.changed', { items: [notice('soil_dry', 'dev-4', 26)] });
      await flush(page);
      expect(podText(page, 'Feucht')).toContain('trocken');
      page.live.emit('attention.changed', { items: [] });
      await flush(page);
      expect(podText(page, 'Feucht')).not.toContain('trocken');
      expect(requests(page, 'GET', '/attention')).toHaveLength(1);
    });

    it('loads the attention items again after a reconnect', async () => {
      const damp = device('dev-4', 'Feucht', { state: { soil_moisture: 26 } });
      const page = await open({ devices: [damp] });
      await flush(page);
      page.server.attention = [notice('soil_dry', 'dev-4', 26)];
      page.live.resync();
      await flush(page);
      expect(requests(page, 'GET', '/attention')).toHaveLength(2);
      expect(podText(page, 'Feucht')).toContain('trocken');
    });

    it('loads the devices and the new hardware again after a reconnect', async () => {
      const page = await open({ devices: [sensor] });
      await flush(page);
      page.server.devices = [{ ...sensor, state: { ...sensor.state, soil_moisture: 55 } }];
      page.live.resync();
      await flush(page);
      expect(requests(page, 'GET', '/devices')).toHaveLength(2);
      expect(podText(page, 'Basilikum')).toContain('55%');
    });

    it('does not let a reload that was on its way undo a live event', async () => {
      const page = await open({ devices: [sensor] });
      await flush(page);
      const release = page.hold();
      page.live.resync();
      page.live.emit('device.state', { ...sensor, state: { ...sensor.state, soil_moisture: 55 } });
      release();
      await flush(page);
      expect(requests(page, 'GET', '/devices')).toHaveLength(2);
      expect(podText(page, 'Basilikum')).toContain('55%');
    });

    it('stays quiet and keeps the values when a reload after a reconnect finds no connection', async () => {
      const page = await open({ devices: [sensor] });
      await flush(page);
      page.server.fail = () => {
        throw new TypeError('offline');
      };
      page.live.resync();
      await flush(page);
      expect(page.snackbar.show).not.toHaveBeenCalled();
      expect(podText(page, 'Basilikum')).toContain('41,3');
    });

    it('does not load every 60 seconds any more', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ devices: [sensor], hardware: [newSensor] });
      await flush(page);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(requests(page, 'GET', '/devices')).toHaveLength(1);
      expect(requests(page, 'GET', '/hardware?state=unassigned')).toHaveLength(1);
    });

    describe('new hardware', () => {
      const card = (page: OpenedHouseholdPage) => page.element.querySelector('app-new-hardware');
      const nameInput = (page: OpenedHouseholdPage) =>
        page.element.querySelector<HTMLInputElement>(
          'app-new-hardware ui-text-field[name="name"] input',
        )!;

      it('shows hardware that is reported and drops one that is gone', async () => {
        const page = await open({ devices: [sensor], hardware: [newSensor] });
        await flush(page);
        page.live.emit('hardware.updated', hardware('bbbb', 'Zigbee Sensor 8'));
        await flush(page);
        expect(pageText(card(page) as HTMLElement)).toContain('Zigbee Sensor 8');
        page.live.emit('hardware.removed', { id: 'bbbb' });
        await flush(page);
        expect(pageText(card(page) as HTMLElement)).not.toContain('Zigbee Sensor 8');
        expect(pageText(card(page) as HTMLElement)).toContain('Zigbee Sensor 7');
      });

      it('forgets the typed name and the error of hardware that is gone', async () => {
        const page = await open({ devices: [sensor], hardware: [newSensor] });
        await flush(page);
        typeInto(page, 'name', '   ');
        await press(page, 'Hinzufügen');
        expect(pageText(card(page) as HTMLElement)).toContain('Bitte gib einen Namen');
        page.live.emit('hardware.removed', { id: 'aaaa' });
        await flush(page);
        expect(card(page)?.querySelector('ui-card')).toBeNull();
        page.live.emit('hardware.updated', newSensor);
        await flush(page);
        expect(nameInput(page).value).toBe('Zigbee Sensor 7');
        expect(pageText(card(page) as HTMLElement)).not.toContain('Bitte gib einen Namen');
      });
    });
  });
});
