import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Language } from '@smart/contracts';
import { AuthService } from '../../core/auth';
import { signedInProviders, TEST_ME } from '../../testing/auth-testing';
import { settle, setupPage } from '../../testing/page-testing';
import { settingsRoutes } from './settings.routes';

/** Mounted where the app mounts it, so the URLs are the real ones. */
const routes = [{ path: 'mehr/einstellungen', loadChildren: () => settingsRoutes }];

const user = (isPlatformAdmin: boolean) => signedInProviders({ ...TEST_ME, isPlatformAdmin });

/** Mounts the settings with a signed-in user, as the app's `signedIn` guard leaves it. */
async function open(isPlatformAdmin: boolean, url: string, language: Language = 'de') {
  const harness = await setupPage(routes, language, user(isPlatformAdmin));
  await TestBed.inject(AuthService).load();
  await harness.navigateByUrl(url);
  await settle(harness);
  return harness;
}

describe('settings page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each([
    ['de', 'Einstellungen', 'Darstellung'],
    ['en', 'Settings', 'Appearance'],
  ] as const)('shows its title and the appearance entry in %s', async (language, title, entry) => {
    const harness = await open(false, '/mehr/einstellungen', language);
    const element = harness.routeNativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe(title);
    const link = element.querySelector('a[href="/mehr/einstellungen/darstellung"]');
    expect(link?.textContent).toContain(entry);
  });

  it('offers no installation entry to a user who is not the platform admin', async () => {
    const harness = await open(false, '/mehr/einstellungen');
    expect(harness.routeNativeElement?.querySelectorAll('ui-list-item').length).toBe(1);
    expect(harness.routeNativeElement?.textContent).not.toContain(
      'Erscheinungsbild der Installation',
    );
  });

  it('lists the installation entry for the platform admin', async () => {
    const harness = await open(true, '/mehr/einstellungen');
    const link = harness.routeNativeElement?.querySelector(
      'a[href="/mehr/einstellungen/installation"]',
    );
    expect(link?.textContent).toContain('Erscheinungsbild der Installation');
  });

  it('redirects the installation page to the settings for a user who is not the platform admin', async () => {
    const harness = await open(false, '/mehr/einstellungen/installation');

    expect(TestBed.inject(Router).url).toBe('/mehr/einstellungen');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Einstellungen',
    );
  });

  it('opens the installation page for the platform admin', async () => {
    const harness = await open(true, '/mehr/einstellungen/installation');

    expect(TestBed.inject(Router).url).toBe('/mehr/einstellungen/installation');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Erscheinungsbild der Installation',
    );
  });
});
