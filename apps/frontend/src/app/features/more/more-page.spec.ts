import type { Language } from '@smart/contracts';
import { provideFeature } from '../../core/features';
import { settle, setupPage } from '../../testing/page-testing';
import { moreRoutes } from './more.routes';

const settingsEntry = provideFeature({
  moreEntries: [
    {
      id: 'settings',
      labelKey: 'app.more.settings',
      icon: 'settings',
      route: '/mehr/einstellungen',
      order: 90,
    },
  ],
});

async function open(language: Language, ...features: ReturnType<typeof provideFeature>[]) {
  const harness = await setupPage(moreRoutes, language, [settingsEntry, ...features]);
  await harness.navigateByUrl('/');
  await settle(harness);
  const element = harness.routeNativeElement as HTMLElement;
  return { element, items: [...element.querySelectorAll('ui-list-item')] };
}

describe('more page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each([
    ['de', 'Mehr'],
    ['en', 'More'],
  ] as const)('shows its title in %s', async (language, title) => {
    const { element } = await open(language);
    expect(element.querySelector('h1')?.textContent?.trim()).toBe(title);
  });

  it('lists the entries ordered by their order, registered ones among the static ones', async () => {
    const { items } = await open(
      'de',
      provideFeature({
        moreEntries: [{ id: 'first', labelKey: 'app.nav.rooms', icon: 'meeting_room', order: 5 }],
      }),
    );
    const headlines = items.map((item) => item.querySelector('.headline')?.textContent?.trim());
    expect(headlines).toEqual([
      'Räume',
      'Module',
      'Benachrichtigungen',
      'Haushalt',
      'Gateways',
      'Einstellungen',
    ]);
  });

  it('links the settings entry', async () => {
    const { items } = await open('de');
    const settings = items.find((item) => item.textContent?.includes('Einstellungen'))!;
    expect(settings.querySelector('a')?.getAttribute('href')).toBe('/mehr/einstellungen');
  });

  it('shows the four coming-soon entries as readable, non-interactive rows', async () => {
    const { items } = await open('de');
    const comingSoon = items.filter((item) => item.textContent?.includes('Kommt bald'));

    expect(comingSoon.map((item) => item.querySelector('.headline')?.textContent?.trim())).toEqual([
      'Module',
      'Benachrichtigungen',
      'Haushalt',
      'Gateways',
    ]);
    for (const item of comingSoon) {
      expect(item.querySelector('a, button, [tabindex], [href]')).toBeNull();
      expect(item.querySelector('.row--disabled')).toBeNull();
    }
  });

  it('translates the entries and the hint in English', async () => {
    const { items } = await open('en');
    expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Modules'),
      expect.stringContaining('Notifications'),
      expect.stringContaining('Household'),
      expect.stringContaining('Gateways'),
      expect.stringContaining('Settings'),
    ]);
    expect(items[0].textContent).toContain('Coming soon');
  });
});
