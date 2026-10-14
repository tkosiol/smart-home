import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Language, Me } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import { injectOverviewCards, resolveOverviewCards } from '../../core/features';
import { householdOf, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageText,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import { device, devicesServer } from './devices-testing';
import { DevicesOverview } from './devices-overview';
import { provideDevicesFeature } from './devices-feature';

const home = householdOf('Home', { role: 'viewer' });

@Component({
  selector: 'app-overview-host',
  imports: [DevicesOverview],
  template: '<h1>Übersicht</h1><app-devices-overview />',
})
class Host {}

function open(
  devices = [device('dev-1', 'Basilikum'), device('dev-2', 'Minze')],
  language: Language = 'de',
) {
  TestBed.overrideProvider(UiClock, {
    useValue: { now: signal(Date.parse('2026-10-14T12:00:00Z')) },
  });
  const { respond } = devicesServer(home.id, { devices });
  const me: Me = meWith([home], home.id);
  return openHouseholdPage([{ path: 'uebersicht', component: Host }], '/uebersicht', {
    language,
    me,
    respond,
  });
}

/** The overview card's texts load lazily: waits until the page shows `text`. */
async function shown(page: OpenedHouseholdPage, text: string) {
  await vi.waitFor(async () => {
    await flush(page, 1);
    expect(pageText(page.element)).toContain(text);
  });
}

describe('devices overview card', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('registers a loader, not the component, so the card stays out of the initial bundle', async () => {
    TestBed.configureTestingModule({ providers: [provideDevicesFeature()] });
    const registered = TestBed.runInInjectionContext(() => injectOverviewCards());
    expect(registered).toHaveLength(1);
    expect(typeof registered[0]).toBe('function');
    expect(registered[0]).not.toBe(DevicesOverview);
    expect(await resolveOverviewCards(registered)).toEqual([DevicesOverview]);
  });

  it('shows one card per device with its main value and battery', async () => {
    const page = await open();
    await shown(page, 'Bodenfeuchte: 41,3 %');
    const cards = [...page.element.querySelectorAll('app-device-card')] as HTMLElement[];
    expect(cards).toHaveLength(2);
    expect(pageText(cards[0]!)).toContain('Basilikum');
    expect(pageText(cards[0]!)).toContain('Bodenfeuchte: 41,3 %');
    expect(pageText(cards[0]!)).toContain('Batterie: 87 %');
    expect(pageText(cards[1]!)).toContain('Minze');
  });

  it('explains an empty household', async () => {
    const page = await open([]);
    await shown(page, 'Noch keine Geräte');
  });

  it('speaks English', async () => {
    const page = await open(undefined, 'en');
    await shown(page, 'Soil moisture: 41.3 %');
  });
});
