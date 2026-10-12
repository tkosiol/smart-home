import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DEFAULT_RUNTIME_CONFIG } from '@smart/contracts';
import { provideRuntimeConfig } from '../../core/config';
import { settle, setupPage } from '../../testing/page-testing';
import { settingsRoutes } from './settings.routes';

/** Mounted where the app mounts it, so the URLs are the real ones. */
const routes = [{ path: 'mehr/einstellungen', loadChildren: () => settingsRoutes }];

const editor = (enabled: boolean) =>
  provideRuntimeConfig({
    ...DEFAULT_RUNTIME_CONFIG,
    features: { instanceAppearanceEditor: enabled },
  });

describe('settings page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each([
    ['de', 'Einstellungen', 'Darstellung'],
    ['en', 'Settings', 'Appearance'],
  ] as const)('shows its title and the appearance entry in %s', async (language, title, entry) => {
    const harness = await setupPage(routes, language, [editor(false)]);
    await harness.navigateByUrl('/mehr/einstellungen');
    await settle(harness);
    const element = harness.routeNativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe(title);
    const link = element.querySelector('a[href="/mehr/einstellungen/darstellung"]');
    expect(link?.textContent).toContain(entry);
  });

  it('offers the installation entry only while the instance editor is on', async () => {
    const off = await setupPage(routes, 'de', [editor(false)]);
    await off.navigateByUrl('/mehr/einstellungen');
    await settle(off);
    expect(off.routeNativeElement?.querySelectorAll('ui-list-item').length).toBe(1);
    expect(off.routeNativeElement?.textContent).not.toContain('Erscheinungsbild der Installation');
  });

  it('lists the installation entry when the instance editor is on', async () => {
    const harness = await setupPage(routes, 'de', [editor(true)]);
    await harness.navigateByUrl('/mehr/einstellungen');
    await settle(harness);
    const link = harness.routeNativeElement?.querySelector(
      'a[href="/mehr/einstellungen/installation"]',
    );
    expect(link?.textContent).toContain('Erscheinungsbild der Installation');
  });

  it('redirects the installation page to the settings while the instance editor is off', async () => {
    const harness = await setupPage(routes, 'de', [editor(false)]);
    await harness.navigateByUrl('/mehr/einstellungen/installation');
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/mehr/einstellungen');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Einstellungen',
    );
  });

  it('opens the installation page while the instance editor is on', async () => {
    const harness = await setupPage(routes, 'de', [editor(true)]);
    await harness.navigateByUrl('/mehr/einstellungen/installation');
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/mehr/einstellungen/installation');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Erscheinungsbild der Installation',
    );
  });
});
