import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Language } from '@smart/contracts';
import { UiAnnouncer, UiClock } from '@smart/ui';
import { injectOverviewBlocks, resolveOverviewBlocks } from '../../core/overview-blocks';
import { householdOf, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageText,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import { provideAttentionFeature } from './attention-feature';
import {
  attentionItem,
  attentionServer,
  manyNotices,
  reportingDevice,
  type ReportingDevice,
} from './attention-testing';
import { StatusBlock } from './status-block';

@Component({
  selector: 'app-overview-host',
  imports: [StatusBlock],
  template: '<h1>Übersicht</h1><app-status-block />',
})
class Host {}

@Component({
  selector: 'app-overview-hidden-host',
  imports: [StatusBlock],
  template: '<h1>Übersicht</h1><app-status-block [visible]="false" />',
})
class HiddenHost {}

interface Options {
  items?: ReturnType<typeof attentionItem>[];
  devices?: ReportingDevice[];
  language?: Language;
  role?: 'owner' | 'member';
  /** The user hid the block: it gets `visible` false. */
  hidden?: boolean;
}

async function open({
  items = [],
  devices = [],
  language = 'de',
  role = 'owner',
  hidden = false,
}: Options = {}) {
  TestBed.overrideProvider(UiClock, {
    useValue: { now: signal(Date.parse('2026-10-14T12:00:00Z')) },
  });
  const announce = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({ providers: [{ provide: UiAnnouncer, useValue: { announce } }] });
  const household = householdOf('Home', { role });
  const server = attentionServer(household.id, { items, devices });
  const page = await openHouseholdPage(
    [{ path: 'uebersicht', component: hidden ? HiddenHost : Host }],
    '/uebersicht',
    { language, me: meWith([household], household.id), respond: server.respond },
  );
  return { ...page, announce, server };
}

/** The block's texts load lazily: waits until the page shows `text`. */
async function shown(page: OpenedHouseholdPage, text: string) {
  await vi.waitFor(async () => {
    await flush(page, 1);
    expect(pageText(page.element)).toContain(text);
  });
}

const hero = (page: OpenedHouseholdPage) => page.element.querySelector('ui-status-hero');

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.setAttribute('lang', 'de');
});

describe('status block', () => {
  it('is registered as the lazy, visible-by-default block that surfaces while hidden', async () => {
    TestBed.configureTestingModule({ providers: [provideAttentionFeature()] });
    const blocks = TestBed.runInInjectionContext(() => injectOverviewBlocks());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'status',
      defaultVisible: true,
      surfaceWhenHidden: true,
      labelKey: 'app.overview.blocks.status.label',
    });
    expect(blocks[0]?.component).not.toBe(StatusBlock);
    expect((await resolveOverviewBlocks(blocks)).map((entry) => entry.component)).toEqual([
      StatusBlock,
    ]);
  });

  describe('with notices', () => {
    it('shows the hero with groups, counts and the critical label (review focus 1)', async () => {
      const page = await open({ items: manyNotices() });
      await shown(page, 'Braucht Aufmerksamkeit · 20');
      const text = pageText(page.element);

      expect(hero(page)?.getAttribute('data-tone')).toBe('critical');
      expect(page.element.querySelectorAll('ui-status-entry')).toHaveLength(3);
      expect(text).toContain('1 kritisch');
      expect(text).toContain('Gateway Pi ist offline');
      expect(text).toContain('18 Geräte nicht erreichbar');
      expect(text).toContain('Kritisch');
      expect(text).toContain('12 Pflanzen zu trocken');
      expect(text).toContain('4 Geräte: Batterie schwach');
      expect(text).not.toContain('Fenster');
      expect(text).toContain('Alle 20 Hinweise');
      expect(text).toContain('1 weitere Gruppe');
    });

    it('is calm-coloured only for warnings: tone attention, no critical count', async () => {
      const page = await open({
        items: [attentionItem('soil_dry', 'Ficus', { value: 18, unit: '%' })],
      });
      await shown(page, 'Ficus ist zu trocken');
      expect(hero(page)?.getAttribute('data-tone')).toBe('attention');
      expect(pageText(page.element)).not.toContain('kritisch');
      expect(pageText(page.element)).toContain('18 %');
      expect(pageText(page.element)).not.toContain('weitere');
    });

    it('links a single notice to its device and a group to the notices of its kind', async () => {
      const page = await open({
        items: [
          attentionItem('soil_dry', 'Ficus'),
          attentionItem('battery_low', 'A'),
          attentionItem('battery_low', 'B'),
        ],
      });
      await shown(page, 'Ficus ist zu trocken');
      const hrefs = [...page.element.querySelectorAll('ui-status-entry a')].map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs).toEqual(['/geraete/dev-Ficus', '/hinweise?art=battery_low']);
    });

    it('does not link entries the user may not open', async () => {
      const page = await open({
        role: 'member',
        items: [attentionItem('gateway_offline', 'Pi', { params: { affectedDevices: 2 } })],
      });
      await shown(page, 'Gateway Pi ist offline');
      expect(page.element.querySelector('ui-status-entry a')).toBeNull();
    });

    it('speaks English', async () => {
      const page = await open({
        language: 'en',
        items: [attentionItem('device_silent', 'Sensor 1')],
      });
      await shown(page, 'Needs attention · 1');
      expect(pageText(page.element)).toContain('Sensor 1 is not reporting');
      expect(pageText(page.element)).toContain('Critical');
    });
  });

  describe('without notices', () => {
    const recent = reportingDevice;

    it('shows the calm row with the gateway, the number of devices and the last message', async () => {
      const page = await open({
        devices: [
          recent('a', '2026-10-14T11:50:00Z'),
          recent('b', '2026-10-14T11:57:00Z'),
          recent('c', null),
        ],
      });
      await shown(page, 'Alles in Ordnung');
      await shown(page, 'Gateway online · 3 Geräte · vor 3 Minuten');
      expect(hero(page)?.getAttribute('data-tone')).toBe('calm');
      expect(page.element.querySelector('ui-status-entry')).toBeNull();
      expect(page.element.querySelector('ui-status-hero a')?.getAttribute('href')).toBe(
        '/hinweise',
      );
    });

    it('says "1 Gerät" and leaves out a time nobody reported', async () => {
      const page = await open({ devices: [recent('a', null)] });
      await shown(page, 'Gateway online · 1 Gerät');
      expect(pageText(page.element)).not.toContain('vor');
    });

    it('points out that there are no devices yet', async () => {
      const page = await open();
      await shown(page, 'Alles in Ordnung');
      await shown(page, 'Noch keine Geräte');
    });

    it('speaks English', async () => {
      const page = await open({ language: 'en', devices: [recent('a', '2026-10-14T11:57:00Z')] });
      await shown(page, 'Gateway online · 1 device · 3 minutes ago');
    });
  });

  describe('when the user hid the block (rule 7)', () => {
    it('shows nothing while no critical notice is open', async () => {
      const page = await open({ hidden: true, items: [attentionItem('soil_dry', 'Ficus')] });
      await flush(page, 6);
      expect(hero(page)).toBeNull();
      expect(pageText(page.element)).not.toContain('Ficus');
    });

    it('shows nothing in the calm state either', async () => {
      const page = await open({ hidden: true, devices: [reportingDevice('a', null)] });
      await flush(page, 6);
      expect(hero(page)).toBeNull();
      // The calm row's devices are not even asked for.
      expect(page.calls.some((call) => call.path.endsWith('/devices'))).toBe(false);
    });

    it('shows the hero, as the block would, as soon as a notice is critical', async () => {
      const page = await open({
        hidden: true,
        items: [attentionItem('soil_dry', 'Ficus'), attentionItem('device_silent', 'Sensor 1')],
      });
      await shown(page, 'Braucht Aufmerksamkeit · 2');
      expect(hero(page)?.getAttribute('data-tone')).toBe('critical');
      expect(pageText(page.element)).toContain('Ficus ist zu trocken');
    });
  });

  describe('announcements', () => {
    const dry = attentionItem('soil_dry', 'Ficus');
    const silent = attentionItem('device_silent', 'Sensor 1');
    const wet = attentionItem('soil_wet', 'Farn');

    /** Lets the minute pass: the block loads the notices again. */
    async function minute(page: OpenedHouseholdPage) {
      await vi.advanceTimersByTimeAsync(60_500);
      await flush(page);
    }

    it('says nothing about the first load, announces a new critical notice at once and other changes politely', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ items: [dry] });
      await shown(page, 'Ficus ist zu trocken');
      expect(page.announce).not.toHaveBeenCalled();

      page.server.state.items = [dry, silent];
      await minute(page);
      expect(page.announce).toHaveBeenLastCalledWith(
        'Kritisch: Sensor 1 meldet sich nicht',
        'assertive',
      );

      page.server.state.items = [dry, silent, wet];
      await minute(page);
      expect(page.announce).toHaveBeenLastCalledWith('Hinweise aktualisiert: 3 offen', 'polite');
      expect(page.announce).toHaveBeenCalledTimes(2);

      // The same notices with other values are no news.
      page.server.state.items = [{ ...dry, value: 3 }, silent, wet];
      await minute(page);
      expect(page.announce).toHaveBeenCalledTimes(2);

      page.server.state.items = [];
      await minute(page);
      expect(page.announce).toHaveBeenLastCalledWith('Keine offenen Hinweise', 'polite');
    });

    it('announces several new critical notices as a count', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ items: [] });
      await flush(page);
      page.server.state.items = [silent, attentionItem('device_silent', 'Sensor 2')];
      await minute(page);
      expect(page.announce).toHaveBeenLastCalledWith('2 neue kritische Hinweise', 'assertive');
    });

    it('does not repeat a critical notice that was already there', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ items: [silent] });
      await flush(page);
      page.server.state.items = [silent, dry];
      await minute(page);
      expect(page.announce).toHaveBeenCalledTimes(1);
      expect(page.announce).toHaveBeenLastCalledWith('Hinweise aktualisiert: 2 offen', 'polite');
    });

    it('announces only critical news while the block is hidden', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const page = await open({ hidden: true, items: [dry] });
      await flush(page);
      page.server.state.items = [dry, wet];
      await minute(page);
      expect(page.announce).not.toHaveBeenCalled();
      page.server.state.items = [dry, wet, silent];
      await minute(page);
      expect(page.announce).toHaveBeenCalledTimes(1);
      expect(page.announce).toHaveBeenLastCalledWith(
        'Kritisch: Sensor 1 meldet sich nicht',
        'assertive',
      );
    });
  });
});
