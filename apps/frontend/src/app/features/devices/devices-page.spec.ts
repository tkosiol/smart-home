import type { Language } from '@smart/contracts';
import { settle, setupPage } from '../../testing/page-testing';
import { devicesRoutes } from './devices.routes';

const TEXTS: Record<Language, { title: string; heading: string; description: string }> = {
  de: {
    title: 'Geräte',
    heading: 'Noch keine Geräte',
    description:
      'Hier erscheinen später alle Geräte des Haushalts, die sich steuern oder ablesen lassen.',
  },
  en: {
    title: 'Devices',
    heading: 'No devices yet',
    description:
      'All devices of the household that can be controlled or read will appear here later.',
  },
};

describe('devices page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each(['de', 'en'] as const)('shows its title and empty state in %s', async (language) => {
    const harness = await setupPage(devicesRoutes, language);
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
