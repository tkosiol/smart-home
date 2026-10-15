import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Language, Me } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import { injectOverviewBlocks, resolveOverviewBlocks } from '../../core/overview-blocks';
import { householdOf, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageText,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import { device, devicesServer } from './devices-testing';
import { DevicesBlock } from './devices-block';
import { provideDevicesFeature } from './devices-feature';

const home = householdOf('Home', { role: 'viewer' });

@Component({
  selector: 'app-overview-host',
  imports: [DevicesBlock],
  template: '<h1>Übersicht</h1><app-devices-block />',
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

/** The block's texts load lazily: waits until the page shows `text`. */
async function shown(page: OpenedHouseholdPage, text: string) {
  await vi.waitFor(async () => {
    await flush(page, 1);
    expect(pageText(page.element)).toContain(text);
  });
}

describe('devices overview block', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('registers a loader, not the component, so the block stays out of the initial bundle', async () => {
    TestBed.configureTestingModule({ providers: [provideDevicesFeature()] });
    const registered = TestBed.runInInjectionContext(() => injectOverviewBlocks());
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      id: 'devices',
      icon: 'devices',
      defaultVisible: true,
      labelKey: 'app.overview.blocks.devices.label',
      descriptionKey: 'app.overview.blocks.devices.description',
    });
    expect(typeof registered[0]?.component).toBe('function');
    expect(registered[0]?.component).not.toBe(DevicesBlock);
    const resolved = await resolveOverviewBlocks(registered);
    expect(resolved.map((entry) => entry.component)).toEqual([DevicesBlock]);
  });

  it('shows one pod per device, a link to its page, with the kind the server computed', async () => {
    const page = await open();
    await shown(page, 'Basilikum');
    await shown(page, 'OK');
    const pods = [...page.element.querySelectorAll('ui-device-pod')] as HTMLElement[];
    expect(pods).toHaveLength(2);
    expect(pageText(pods[0]!)).toContain('41,3');
    expect(pageText(pods[0]!)).toContain('Basilikum');
    expect(pageText(pods[0]!)).toContain('OK');
    expect(pods[0]!.querySelector('a')?.getAttribute('href')).toBe('/geraete/dev-1');
    expect(pageText(pods[1]!)).toContain('Minze');
    expect(page.element.querySelector('h2')?.textContent?.trim()).toBe('Geräte');
  });

  it('puts the pods in a wrapping row', async () => {
    const page = await open();
    await shown(page, 'Basilikum');
    expect(page.element.querySelector('ui-pod-row')?.hasAttribute('data-wrap')).toBe(true);
  });

  it('explains an empty household and leads to the devices page', async () => {
    const page = await open([]);
    await shown(page, 'Noch keine Geräte');
    expect(pageText(page.element)).toContain('„Geräte → Neu erkannt“');
    const link = page.element.querySelector<HTMLAnchorElement>('ui-empty-state a');
    expect(link?.getAttribute('href')).toBe('/geraete');
    expect(link?.textContent?.trim()).toBe('Zu den Geräten');
  });

  it('has no empty state when there are devices', async () => {
    const page = await open();
    await shown(page, 'Basilikum');
    expect(page.element.querySelector('ui-empty-state')).toBeNull();
  });

  it('speaks English in the empty household', async () => {
    const page = await open([], 'en');
    await shown(page, 'No devices yet');
    expect(pageText(page.element)).toContain('“Devices → Newly discovered”');
    expect(page.element.querySelector('ui-empty-state a')?.textContent?.trim()).toBe(
      'Go to devices',
    );
  });

  it('speaks English', async () => {
    const page = await open([device('dev-1', 'Basil', { availability: 'offline' })], 'en');
    await shown(page, 'Offline');
    expect(pageText(page.element)).toContain('41.3');
  });
});
