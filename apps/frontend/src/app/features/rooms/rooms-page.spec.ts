import type { Language } from '@smart/contracts';
import { settle, setupPage } from '../../testing/page-testing';
import { roomsRoutes } from './rooms.routes';

const TEXTS: Record<Language, { title: string; heading: string; description: string }> = {
  de: {
    title: 'Räume',
    heading: 'Noch keine Räume',
    description: 'Hier erscheinen später die Räume des Haushalts mit ihren Geräten.',
  },
  en: {
    title: 'Rooms',
    heading: 'No rooms yet',
    description: 'The rooms of the household and their devices will appear here later.',
  },
};

describe('rooms page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each(['de', 'en'] as const)('shows its title and empty state in %s', async (language) => {
    const harness = await setupPage(roomsRoutes, language);
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
