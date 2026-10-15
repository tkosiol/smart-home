import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Language } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import { householdOf, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageText,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import { attentionRoutes } from './attention.routes';
import { attentionItem, attentionServer, manyNotices } from './attention-testing';

const routes = [{ path: 'hinweise', loadChildren: () => attentionRoutes }];
const NOW = Date.parse('2026-10-14T12:00:00Z');

interface Options {
  items?: ReturnType<typeof attentionItem>[];
  language?: Language;
  role?: 'owner' | 'member';
  url?: string;
}

async function open({ items = [], language = 'de', role = 'owner', url = '/hinweise' }: Options) {
  TestBed.overrideProvider(UiClock, { useValue: { now: signal(NOW) } });
  const household = householdOf('Home', { role });
  const server = attentionServer(household.id, { items });
  const page = await openHouseholdPage(routes, url, {
    language,
    me: meWith([household], household.id),
    respond: server.respond,
  });
  await flush(page);
  return Object.assign(page, { server });
}

/** The chips of the set with this label, as [text, selected]. */
function chips(page: OpenedHouseholdPage, label: string) {
  const set = page.element.querySelector(`ui-chip-set [aria-label="${label}"]`);
  return [...(set?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
}
const severityChips = (page: OpenedHouseholdPage) => chips(page, 'Nach Dringlichkeit filtern');
const kindChips = (page: OpenedHouseholdPage) => chips(page, 'Nach Art filtern');
/** "Label count": the space between them is made by the chip's styles. */
const chipTexts = (list: HTMLElement[]) =>
  list.map((chip) =>
    [chip.querySelector('.label'), chip.querySelector('.count')]
      .map((part) => part?.textContent?.trim())
      .join(' '),
  );
const selected = (list: HTMLElement[]) =>
  list.filter((chip) => chip.getAttribute('aria-selected') === 'true');
const cards = (page: OpenedHouseholdPage) =>
  [...page.element.querySelectorAll('ui-card')].map((card) =>
    card.querySelector('h3')?.textContent?.trim(),
  );
/** An entry as [title, subtitle, value] (the parts have no space between them in the DOM). */
const entries = (page: OpenedHouseholdPage) =>
  [...page.element.querySelectorAll('ui-status-entry')].map((entry) =>
    ['.title', '.subtitle', '.value'].map((part) => entry.querySelector(part)?.textContent?.trim()),
  );

async function click(page: OpenedHouseholdPage, chip: HTMLElement | undefined) {
  chip!.click();
  await flush(page);
}

const mixed = () => [
  attentionItem('gateway_offline', 'Pi', { params: { affectedDevices: 2 } }),
  attentionItem('soil_dry', 'Ficus', { value: 18, unit: '%' }),
  attentionItem('soil_dry', 'Palme', { value: 20, unit: '%' }),
  attentionItem('battery_low', 'Sensor 1', { value: 9, unit: '%' }),
  attentionItem('contact_open', 'Fenster'),
];

describe('attention page', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.setAttribute('lang', 'de');
  });

  it('shows a section per severity with a card per kind and an entry per notice', async () => {
    const page = await open({ items: mixed() });
    expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('Alle Hinweise');
    expect(pageText(page.element)).toContain('5 offen · nach Dringlichkeit, dann neueste zuerst');
    expect(
      [...page.element.querySelectorAll('ui-section h2')].map((h) => h.textContent?.trim()),
    ).toEqual(['Kritisch', 'Warnungen', 'Hinweise']);
    expect(cards(page)).toEqual([
      'Gateway offline',
      'Zu trocken',
      'Batterie schwach',
      'Offene Kontakte',
    ]);
    const text = pageText(page.element);
    expect(text).toContain('2 Hinweise');
    expect(entries(page)).toEqual([
      ['Pi', '2 Geräte nicht erreichbar · vor 1 Stunde', undefined],
      ['Ficus', 'vor 1 Stunde', expect.stringMatching(/^18\s%$/)],
      ['Palme', 'vor 1 Stunde', expect.stringMatching(/^20\s%$/)],
      ['Sensor 1', 'vor 1 Stunde', expect.stringMatching(/^9\s%$/)],
      ['Fenster', 'vor 1 Stunde', undefined],
    ]);
  });

  it('leads each entry to its device or gateway', async () => {
    const page = await open({ items: mixed() });
    const hrefs = [...page.element.querySelectorAll('ui-status-entry')].map((entry) =>
      entry.querySelector('a')?.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '/mehr/gateways',
      '/geraete/dev-Ficus',
      '/geraete/dev-Palme',
      '/geraete/dev-Sensor%201',
      '/geraete/dev-Fenster',
    ]);
  });

  it('does not link the gateway to someone who may not open the gateways', async () => {
    const page = await open({ items: mixed(), role: 'member' });
    expect(page.element.querySelector('ui-status-entry a')?.getAttribute('href')).toBe(
      '/geraete/dev-Ficus',
    );
    expect(page.element.querySelectorAll('ui-status-entry a')).toHaveLength(4);
  });

  describe('filter chips', () => {
    it('count the notices and start with "Alle"', async () => {
      const page = await open({ items: mixed() });
      expect(chipTexts(severityChips(page))).toEqual([
        'Alle 5',
        'Kritisch 1',
        'Warnung 3',
        'Hinweis 1',
      ]);
      expect(chipTexts(selected(severityChips(page)))).toEqual(['Alle 5']);
      expect(chipTexts(kindChips(page))).toEqual([
        'Gateway offline 1',
        'Zu trocken 2',
        'Batterie schwach 1',
        'Offene Kontakte 1',
      ]);
      expect(selected(kindChips(page))).toHaveLength(0);
    });

    it('filter by severity, several at once, and "Alle" clears them', async () => {
      const page = await open({ items: mixed() });
      await click(page, severityChips(page)[2]);
      expect(chipTexts(selected(severityChips(page)))).toEqual(['Warnung 3']);
      expect(cards(page)).toEqual(['Zu trocken', 'Batterie schwach']);

      await click(page, severityChips(page)[1]);
      expect(chipTexts(selected(severityChips(page)))).toEqual(['Kritisch 1', 'Warnung 3']);
      expect(cards(page)).toEqual(['Gateway offline', 'Zu trocken', 'Batterie schwach']);

      await click(page, severityChips(page)[0]);
      expect(chipTexts(selected(severityChips(page)))).toEqual(['Alle 5']);
      expect(cards(page)).toHaveLength(4);
    });

    it('go back to "Alle" when the last severity is switched off', async () => {
      const page = await open({ items: mixed() });
      await click(page, severityChips(page)[1]);
      await click(page, severityChips(page)[1]);
      expect(chipTexts(selected(severityChips(page)))).toEqual(['Alle 5']);
      expect(cards(page)).toHaveLength(4);
    });

    it('keep "Alle" selected when it is pressed while it is the only one', async () => {
      const page = await open({ items: mixed() });
      await click(page, severityChips(page)[0]);
      expect(chipTexts(selected(severityChips(page)))).toEqual(['Alle 5']);
      expect(cards(page)).toHaveLength(4);
    });

    it('filter by kind, several at once', async () => {
      const page = await open({ items: mixed() });
      await click(page, kindChips(page)[1]);
      expect(cards(page)).toEqual(['Zu trocken']);
      expect(entries(page)).toHaveLength(2);
      await click(page, kindChips(page)[3]);
      expect(cards(page)).toEqual(['Zu trocken', 'Offene Kontakte']);
      await click(page, kindChips(page)[1]);
      expect(cards(page)).toEqual(['Offene Kontakte']);
    });

    it('combine severity and kind', async () => {
      const page = await open({ items: mixed() });
      await click(page, severityChips(page)[2]);
      await click(page, kindChips(page)[3]);
      expect(cards(page)).toEqual([]);
      expect(pageText(page.element)).toContain('Zu dieser Auswahl gibt es keine Hinweise.');
    });

    it('leave out the kind chips while there is only one kind', async () => {
      const page = await open({ items: [attentionItem('soil_dry', 'Ficus')] });
      expect(severityChips(page)).toHaveLength(4);
      expect(kindChips(page)).toHaveLength(0);
    });
  });

  describe('a link from the overview', () => {
    it('preselects the kind of ?art=', async () => {
      const page = await open({ items: mixed(), url: '/hinweise?art=battery_low' });
      expect(chipTexts(selected(kindChips(page)))).toEqual(['Batterie schwach 1']);
      expect(cards(page)).toEqual(['Batterie schwach']);
      // Chips with the numbers of all notices stay readable, the user can add kinds.
      await click(page, kindChips(page)[1]);
      expect(cards(page)).toEqual(['Zu trocken', 'Batterie schwach']);
    });

    it('preselects several kinds', async () => {
      const page = await open({ items: mixed(), url: '/hinweise?art=soil_dry,contact_open' });
      expect(cards(page)).toEqual(['Zu trocken', 'Offene Kontakte']);
    });

    it.each(['nonsense', 'soil_wet'])('shows everything for the kind "%s"', async (art) => {
      // Nobody knows it, or no notice has it: an empty page would only confuse.
      const page = await open({ items: mixed(), url: `/hinweise?art=${art}` });
      expect(cards(page)).toHaveLength(4);
    });

    it('follows the entry of a group on the overview to the notices of that kind', async () => {
      const page = await open({ items: manyNotices(), url: '/hinweise?art=contact_open' });
      expect(cards(page)).toEqual(['Offene Kontakte']);
      expect(entries(page)).toHaveLength(3);
    });
  });

  it('says "Nichts zu tun" without notices', async () => {
    const page = await open({ items: [] });
    expect(pageText(page.element)).toContain('Nichts zu tun');
    expect(page.element.querySelector('ui-chip-set')).toBeNull();
    expect(page.element.querySelector('ui-status-entry')).toBeNull();
  });

  it('says what a certificate is about, not only its name', async () => {
    const page = await open({
      items: [attentionItem('cert_expiring', 'Pi', { params: { subject: 'crl' } })],
    });
    expect(entries(page)[0]![0]).toBe('Sperrliste läuft bald ab');
  });

  it('speaks English', async () => {
    const page = await open({ items: mixed(), language: 'en' });
    expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('All notices');
    expect(pageText(page.element)).toContain('5 open · by urgency, then newest first');
    expect(pageText(page.element)).toContain('Too dry');
    expect(pageText(page.element)).toContain('2 devices unreachable · 1 hour ago');
  });

  describe('refresh', () => {
    const visibility = (state: DocumentVisibilityState) =>
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
    const gets = (page: OpenedHouseholdPage) =>
      page.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/attention'));

    it('loads again after 60 seconds and shows what changed', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ items: [attentionItem('soil_dry', 'Ficus')] });
      expect(gets(page)).toHaveLength(1);
      page.server.state.items = [];
      await vi.advanceTimersByTimeAsync(60_500);
      await flush(page);
      expect(gets(page)).toHaveLength(2);
      expect(pageText(page.element)).toContain('Nichts zu tun');
    });

    it('does not load while the tab is hidden', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ items: mixed() });
      visibility('hidden');
      await vi.advanceTimersByTimeAsync(180_000);
      await flush(page);
      expect(gets(page)).toHaveLength(1);
    });
  });

  it('asks only for the notices, not for the devices of the calm row', async () => {
    const page = await open({ items: [] });
    expect(page.calls.filter((call) => call.path.endsWith('/devices'))).toHaveLength(0);
  });
});
