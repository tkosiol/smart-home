import { Component } from '@angular/core';
import { provideFeature } from '../../core/features';
import type { Language } from '@smart/contracts';
import { settle, setupPage } from '../../testing/page-testing';
import { dashboardRoutes } from './dashboard.routes';

const TEXTS: Record<Language, { title: string; heading: string; description: string }> = {
  de: {
    title: 'Übersicht',
    heading: 'Noch nichts zu sehen',
    description: 'Hier erscheinen später Räume, Geräte und Hinweise auf einen Blick.',
  },
  en: {
    title: 'Overview',
    heading: 'Nothing to see yet',
    description: 'Rooms, devices and notices will show up here at a glance later.',
  },
};

describe('dashboard page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each(['de', 'en'] as const)('shows its title and empty state in %s', async (language) => {
    const harness = await setupPage(dashboardRoutes, language);
    await harness.navigateByUrl('/');
    await settle(harness);
    const element = harness.routeNativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe(TEXTS[language].title);
    expect(element.querySelector('ui-empty-state h2')?.textContent?.trim()).toBe(
      TEXTS[language].heading,
    );
    expect(element.querySelector('ui-empty-state p')?.textContent?.trim()).toBe(
      TEXTS[language].description,
    );
  });
});

@Component({ selector: 'app-test-card', template: 'Test card' })
class TestCard {}

describe('dashboard page with overview cards', () => {
  it('renders registered cards instead of the empty state', async () => {
    const harness = await setupPage(dashboardRoutes, 'de', [
      provideFeature({ overviewCards: [TestCard] }),
    ]);
    await harness.navigateByUrl('/');
    await settle(harness);
    const element = harness.routeNativeElement as HTMLElement;

    expect(element.querySelector('app-test-card')?.textContent).toBe('Test card');
    expect(element.querySelector('ui-empty-state')).toBeNull();
  });
});
