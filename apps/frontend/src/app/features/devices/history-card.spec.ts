import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import type { DeviceHistory, HistoryRange, Language, Me } from '@smart/contracts';
import { UiChart, UiClock } from '@smart/ui';
import { apiError, householdOf, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageText,
  press,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import { device, devicesServer, historyOf, type DevicesServer } from './devices-testing';
import { deviceRoutes } from './devices.routes';

const owner = householdOf('Home', { role: 'owner' });
const routes = [{ path: 'geraete/:id', loadChildren: () => deviceRoutes }];
const NOW = Date.parse('2026-10-14T12:00:00Z');

const sensor = device('dev-1', 'Basilikum');

interface Options extends Partial<DevicesServer> {
  language?: Language;
  /** Called before the server answers a history request (to make one slow). */
  before?: (capability: string, range: HistoryRange) => Promise<void> | undefined;
}

async function open({ language = 'de', before, ...initial }: Options = {}) {
  TestBed.overrideProvider(UiClock, { useValue: { now: signal(NOW) } });
  const { state, respond } = devicesServer(owner.id, { devices: [sensor], ...initial });
  const me: Me = meWith([owner], owner.id);
  const page = await openHouseholdPage(routes, '/geraete/dev-1', {
    language,
    me,
    respond: async (call) => {
      const match = /history\?capability=([^&]+)&range=(\w+)/.exec(call.path);
      if (match) await before?.(match[1]!, match[2] as HistoryRange);
      return respond(call);
    },
  });
  await flush(page);
  return Object.assign(page, { server: state });
}

const historyCalls = (page: OpenedHouseholdPage) =>
  page.calls
    .filter((call) => call.path.includes('/history?'))
    .map((call) => call.path.replace(/^.*history\?/, ''));
const card = (page: OpenedHouseholdPage) =>
  page.element.querySelector<HTMLElement>('app-history-card')!;
const cardText = (page: OpenedHouseholdPage) => pageText(card(page));
/** What the value readout says (the chart's own SVG text, e.g. its band label, is not part of it). */
const readoutText = (page: OpenedHouseholdPage) =>
  pageText(card(page).querySelector<HTMLElement>('[aria-live]')!);
const toggleTable = async (page: OpenedHouseholdPage) => {
  card(page).querySelector<HTMLButtonElement>('button[aria-label="Werte als Tabelle"]')!.click();
  await flush(page);
};
const headers = (page: OpenedHouseholdPage) =>
  [...card(page).querySelectorAll('thead th')].map((cell) => cell.textContent?.trim());
const chart = (page: OpenedHouseholdPage) =>
  page.harness.fixture.debugElement.query(By.directive(UiChart));
const chartInputs = (page: OpenedHouseholdPage) => chart(page).componentInstance as UiChart;
const scrub = async (page: OpenedHouseholdPage, index: number | null) => {
  chart(page).triggerEventHandler('scrubbed', index);
  await flush(page);
};
const radio = (page: OpenedHouseholdPage, name: string) =>
  [...card(page).querySelectorAll<HTMLButtonElement>('[role="radio"], [role="option"]')].find(
    (el) => el.textContent?.trim() === name,
  )!;
const choose = async (page: OpenedHouseholdPage, name: string) => {
  radio(page, name).click();
  await flush(page);
};
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

describe('history card', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.setAttribute('lang', 'de');
  });

  describe('opening', () => {
    it('asks for the main value over 7 days and draws it', async () => {
      const page = await open();
      expect(historyCalls(page)).toEqual(['capability=soil_moisture&range=7d']);
      expect(card(page).querySelector('h2')?.textContent?.trim()).toBe('Verlauf');
      expect(chart(page)).toBeTruthy();
      const inputs = chartInputs(page);
      expect(inputs.kind()).toBe('area');
      expect(inputs.range()).toBe('7d');
      expect(inputs.domain()).toEqual({ min: 0, max: 80 });
      expect(inputs.band()).toMatchObject({ below: 25, label: 'zu trocken' });
      expect(inputs.label()).toBe('Bodenfeuchte, letzte 7 Tage');
      expect(radio(page, '7 Tage').getAttribute('aria-checked')).toBe('true');
    });

    it('offers the numeric readings as chips, the main value first and chosen', async () => {
      const page = await open();
      const chips = [...card(page).querySelectorAll('ui-chip-set [role="option"]')];
      expect(chips.map((chip) => chip.querySelector('.label')?.textContent)).toEqual([
        'Bodenfeuchte',
        'Temperatur',
        'Batterie',
        'Signalqualität',
      ]);
      expect(chips[0]!.getAttribute('aria-selected')).toBe('true');
    });

    it('shows no chips for a device with a single reading', async () => {
      const page = await open({
        devices: [
          device('dev-1', 'Basilikum', {
            capabilities: [device('x', 'x').capabilities[0]!],
          }),
        ],
      });
      expect(card(page).querySelector('ui-chip-set')).toBeNull();
      expect(chart(page)).toBeTruthy();
    });

    it('is left out for a device without a numeric reading', async () => {
      const page = await open({ devices: [device('dev-1', 'x', { capabilities: [] })] });
      expect(card(page)).toBeNull();
      expect(historyCalls(page)).toEqual([]);
    });

    it('shows the current value with "Jetzt" and the last watering', async () => {
      const page = await open({
        history: (capability, range) => historyOf(capability, range, (i) => (i < 150 ? 30 : 50)),
      });
      const text = cardText(page);
      expect(text).toContain(`41,3`);
      expect(text).toContain('Jetzt');
      expect(text).toContain('zuletzt gegossen vor');
    });
  });

  describe('choices', () => {
    it('loads the other reading and the other period', async () => {
      const page = await open();
      await choose(page, 'Temperatur');
      expect(historyCalls(page).at(-1)).toBe('capability=temperature&range=7d');
      expect(chartInputs(page).band()).toBeNull();
      expect(chartInputs(page).domain()).toBeNull();
      await choose(page, '24 h');
      expect(historyCalls(page).at(-1)).toBe('capability=temperature&range=24h');
      expect(chartInputs(page).resolutionMinutes()).toBe(15);
      await choose(page, '4 Wochen');
      expect(historyCalls(page).at(-1)).toBe('capability=temperature&range=28d');
      expect(chartInputs(page).kind()).toBe('ribbon');
      expect(chartInputs(page).points()).toHaveLength(28);
    });

    it('never lets a late answer of the earlier choice replace the current one', async () => {
      const slow = gate();
      const page = await open({
        before: (capability, range) =>
          capability === 'soil_moisture' && range === '24h' ? slow.promise : undefined,
      });
      await choose(page, '24 h'); // asked, the answer is on its way
      await choose(page, '4 Wochen'); // asked and answered
      expect(chartInputs(page).range()).toBe('28d');
      expect(chartInputs(page).points()).toHaveLength(672);
      slow.release();
      await flush(page);
      expect(chartInputs(page).range()).toBe('28d');
      expect(chartInputs(page).points()).toHaveLength(672);
      expect(radio(page, '4 Wochen').getAttribute('aria-checked')).toBe('true');
    });

    it('drops a late answer of the earlier reading as well', async () => {
      const slow = gate();
      const page = await open({
        history: (capability, range) =>
          historyOf(capability, range, () => (capability === 'temperature' ? 21 : 55)),
        before: (capability, range) =>
          capability === 'soil_moisture' && range === '7d' ? slow.promise : undefined,
      });
      expect(card(page).querySelector('ui-skeleton')).not.toBeNull();
      await choose(page, 'Temperatur');
      slow.release();
      await flush(page);
      expect(chartInputs(page).points()[0]!.value).toBe(21);
      expect(chartInputs(page).band()).toBeNull();
      expect(chartInputs(page).label()).toContain('Temperatur');
    });
  });

  describe('scrubbing', () => {
    const wet = (capability: string, range: HistoryRange) =>
      historyOf(capability, range, (i) => (i === 10 ? 12 : 40));

    it('shows the value of the point and its hour, and marks a dry one', async () => {
      const page = await open({ history: wet });
      await scrub(page, 10);
      const text = readoutText(page);
      expect(text).toContain('12');
      expect(text).toMatch(/Okt\., \d{1,2}[–-]\d{1,2} Uhr/);
      expect(text).toContain('zu trocken');
      expect(text).not.toContain('Jetzt');
      await scrub(page, 11);
      expect(readoutText(page)).toContain('40');
      expect(readoutText(page)).not.toContain('zu trocken');
      await scrub(page, null);
      expect(readoutText(page)).toContain('Jetzt');
      expect(readoutText(page)).toContain('41,3');
    });

    it('shows the quarter hour of a 24 hour point', async () => {
      const page = await open({ history: wet });
      await choose(page, '24 h');
      await scrub(page, 0);
      expect(readoutText(page)).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
    });

    it('goes back to the current value when the chart reloads', async () => {
      const page = await open({ history: wet });
      await scrub(page, 10);
      await choose(page, 'Temperatur');
      expect(cardText(page)).toContain('Jetzt');
    });

    it('has no band and never says "zu trocken" without a threshold (Review Focus 4)', async () => {
      const base = device('dev-1', 'Basilikum');
      const page = await open({
        devices: [
          {
            ...base,
            effectiveThresholds: { ...base.effectiveThresholds, soilMoistureMin: null },
          },
        ],
        history: (capability, range) => historyOf(capability, range, () => 3),
      });
      expect(chartInputs(page).band()).toBeNull();
      await scrub(page, 5);
      expect(cardText(page)).not.toContain('zu trocken');
      expect(cardText(page)).toContain('Tief');
      expect(page.element.textContent).not.toContain('zu trocken');
    });
  });

  describe('summary', () => {
    it('says what happened in the period, only what applies', async () => {
      const page = await open({
        history: (capability, range) =>
          historyOf(capability, range, (i) => (i < 20 ? 20 : i === 20 ? 45 : 40)),
      });
      const text = cardText(page);
      expect(text).toContain('Tief 19 %');
      expect(text).toContain('Hoch 46 %');
      expect(text).toContain('20 Std. zu trocken');
      expect(text).toContain('1× gegossen');
      expect(chartInputs(page).markers()).toHaveLength(1);
    });

    it('leaves out the dry time and the waterings of a plant that was fine', async () => {
      const page = await open();
      const text = cardText(page);
      expect(text).toContain('Tief');
      expect(text).not.toContain('Std. zu trocken');
      expect(text).not.toContain('gegossen');
    });
  });

  describe('table', () => {
    it('replaces the chart with the values, newest first', async () => {
      const page = await open();
      await toggleTable(page);
      expect(chart(page)).toBeNull();
      const toggle = card(page).querySelector('ui-icon-button button')!;
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      const rows = card(page).querySelectorAll('tbody tr');
      expect(rows).toHaveLength(168);
      expect(rows[0]!.textContent).toContain('Uhr');
      expect(headers(page)).toEqual(['Zeit', 'Bodenfeuchte']);
      expect(
        card(page).querySelector('ui-value-table [role="group"]')?.getAttribute('aria-label'),
      ).toBe('Bodenfeuchte, letzte 7 Tage');
      await toggleTable(page);
      expect(chart(page)).toBeTruthy();
      expect(card(page).querySelector('table')).toBeNull();
    });

    it('lists 4 weeks per day', async () => {
      const page = await open({
        history: (capability, range) => historyOf(capability, range, (i) => (i < 24 ? 20 : 40)),
      });
      await choose(page, '4 Wochen');
      await toggleTable(page);
      const rows = [...card(page).querySelectorAll('tbody tr')];
      expect(rows).toHaveLength(28);
      expect(headers(page)).toEqual(['Tag', 'Mittel', 'Tief–Hoch']);
      expect(rows.at(-1)!.querySelectorAll('td')).toHaveLength(3);
      expect(rows.at(-1)!.querySelector('td .note')?.textContent).toBe('zeitweise zu trocken');
    });
  });

  describe('states', () => {
    it('shows a skeleton while loading', async () => {
      const slow = gate();
      const page = await open({ before: () => slow.promise });
      expect(card(page).querySelector('ui-skeleton')?.getAttribute('data-variant')).toBe('chart');
      expect(chart(page)).toBeNull();
      slow.release();
      await flush(page);
      expect(card(page).querySelector('ui-skeleton')).toBeNull();
    });

    it('says so when there are no values in the period', async () => {
      const page = await open({
        history: (capability, range) => ({ ...historyOf(capability, range), points: [] }),
      });
      expect(card(page).querySelector('ui-figure .message')?.textContent).toBe(
        'Noch keine Messwerte in diesem Zeitraum',
      );
      expect(chart(page)).toBeNull();
      expect(cardText(page)).not.toContain('Tief');
      expect(card(page).querySelector('figcaption')).toBeNull();
    });

    it('offers to try again after an error', async () => {
      let fail = true;
      const page = await open({
        history: (capability, range): DeviceHistory | Response =>
          fail ? apiError('internal', 500) : historyOf(capability, range),
      });
      expect(card(page).querySelector('ui-figure .message')?.textContent).toBe(
        'Der Verlauf konnte nicht geladen werden.',
      );
      expect(chart(page)).toBeNull();
      fail = false;
      await press(page, 'Erneut versuchen');
      expect(chart(page)).toBeTruthy();
      expect(historyCalls(page)).toHaveLength(2);
    });
  });

  describe('refresh', () => {
    it('loads again every five minutes and keeps the values while it does', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open();
      await vi.advanceTimersByTimeAsync(299_000);
      expect(historyCalls(page)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_500);
      await flush(page);
      expect(historyCalls(page)).toEqual([
        'capability=soil_moisture&range=7d',
        'capability=soil_moisture&range=7d',
      ]);
      expect(chart(page)).toBeTruthy();
    });

    it('keeps the old values when a refresh fails', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      let fail = false;
      const page = await open({
        history: (capability, range): DeviceHistory | Response =>
          fail ? apiError('internal', 500) : historyOf(capability, range),
      });
      fail = true;
      await vi.advanceTimersByTimeAsync(300_500);
      await flush(page);
      expect(historyCalls(page)).toHaveLength(2);
      expect(chart(page)).toBeTruthy();
      expect(cardText(page)).not.toContain('konnte nicht geladen');
    });
  });

  it('speaks English', async () => {
    const page = await open({ language: 'en' });
    expect(card(page).querySelector('h2')?.textContent?.trim()).toBe('History');
    expect(radio(page, '7 days')).toBeTruthy();
    expect(cardText(page)).toContain('Now');
  });
});
