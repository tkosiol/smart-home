import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadWithServiceWorkerInControl } from '../helpers/service-worker';

const PHONE = { width: 390, height: 844 };
const RAIL = { width: 700, height: 900 };
const DESKTOP = { width: 1280, height: 800 };

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Hauptnavigation' });
/** The icons put glyph characters into the link text; the accessible name is just the label. */
async function expectDestinations(nav: Locator, names: string[]) {
  await expect(nav.getByRole('link')).toHaveCount(names.length);
  for (const name of names)
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
}

const shell = (page: Page) => page.locator('ui-adaptive-shell');

/** Where the navigation sits: the shell reports its window class, the box tells how it is drawn. */
async function navigationBox(page: Page) {
  const box = await navigation(page).boundingBox();
  if (!box) throw new Error('the navigation has no box');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  return {
    ...box,
    atBottom:
      Math.abs(box.y + box.height - viewport.height) <= 1 && box.width >= viewport.width - 1,
    atLeft: box.x === 0 && box.height >= viewport.height - 1,
  };
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('the bottom bar offers four destinations and marks the current one', async ({ page }) => {
    await page.goto('/');
    await expect(shell(page)).toHaveAttribute('data-window-class', 'compact');
    await expectDestinations(navigation(page), ['Übersicht', 'Räume', 'Geräte', 'Mehr']);
    expect((await navigationBox(page)).atBottom).toBe(true);
    await expect(navigation(page).getByRole('link', { name: 'Übersicht' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await navigation(page).getByRole('link', { name: 'Räume' }).click();
    await expect(page).toHaveURL(/\/raeume$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Räume' })).toBeVisible();
    await expect(navigation(page).getByRole('link', { name: 'Räume' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(navigation(page).getByRole('link', { name: 'Übersicht' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: DESKTOP });

  test('the drawer leads to the more list with settings and inert coming-soon rows', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(shell(page)).toHaveAttribute('data-window-class', 'expanded');
    const box = await navigationBox(page);
    expect(box.atLeft).toBe(true);
    expect(box.width).toBeGreaterThan(300);

    await navigation(page).getByRole('link', { name: 'Mehr' }).click();
    await expect(page).toHaveURL(/\/mehr$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mehr' })).toBeVisible();

    const list = page.getByRole('list');
    await expect(list.getByRole('link', { name: /Einstellungen/ })).toBeVisible();
    await expect(list.getByText('Kommt bald')).toHaveCount(4);
    for (const name of ['Module', 'Benachrichtigungen', 'Haushalt', 'Gateways']) {
      await expect(list.getByText(name, { exact: true })).toBeVisible();
      await expect(list.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
    }
  });
});

test('the navigation follows the window width without a reload', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await expect(shell(page)).toHaveAttribute('data-window-class', 'expanded');
  expect((await navigationBox(page)).width).toBeGreaterThan(300);

  await page.setViewportSize(RAIL);
  await expect(shell(page)).toHaveAttribute('data-window-class', 'medium');
  const rail = await navigationBox(page);
  expect(rail.atLeft).toBe(true);
  expect(rail.width).toBeLessThan(150);
  expect(rail.atBottom).toBe(false);

  await page.setViewportSize(PHONE);
  await expect(shell(page)).toHaveAttribute('data-window-class', 'compact');
  const bar = await navigationBox(page);
  expect(bar.atBottom).toBe(true);
  expect(bar.atLeft).toBe(false);
});

test('every page names itself in the document title and takes the focus', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Übersicht – Smart Home');
  await navigation(page).getByRole('link', { name: 'Räume' }).click();
  await expect(page).toHaveTitle('Räume – Smart Home');
  // The focus moves to the heading, so a screen reader announces the new page.
  await expect(page.getByRole('heading', { level: 1, name: 'Räume' })).toBeFocused();
  await navigation(page).getByRole('link', { name: 'Mehr' }).click();
  await expect(page).toHaveTitle('Mehr – Smart Home');
  await page.getByRole('link', { name: /Einstellungen/ }).click();
  await expect(page).toHaveTitle('Einstellungen – Smart Home');
  await page.getByRole('link', { name: /Darstellung/ }).click();
  await expect(page).toHaveTitle('Darstellung – Smart Home');
  await page.goto('/gibt-es-nicht');
  await expect(page).toHaveTitle('Nicht gefunden – Smart Home');
});

test('the document title follows the language', async ({ page }) => {
  await page.goto('/mehr/einstellungen/darstellung');
  await expect(page).toHaveTitle('Darstellung – Smart Home');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page).toHaveTitle('Appearance – Smart Home');
});

test.describe('deep links', () => {
  test('a deep route loads its page directly', async ({ page }) => {
    const response = await page.goto('/mehr/einstellungen/darstellung');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Darstellung' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Dunkel' })).toBeVisible();
    await expect(navigation(page).getByRole('link', { name: 'Mehr' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('an unknown route says so and links back to the overview', async ({ page }) => {
    await page.goto('/gibt-es-nicht');
    await expect(page.getByRole('heading', { level: 1, name: 'Nicht gefunden' })).toBeVisible();
    await page.getByRole('link', { name: 'Zur Übersicht' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
  });
});

test.describe('offline, served by the service worker', () => {
  test('deep links and unknown routes still render their pages and show the offline banner', async ({
    page,
    context,
  }) => {
    await loadWithServiceWorkerInControl(page);
    await context.setOffline(true);

    await page.goto('/mehr/einstellungen/darstellung');
    await expect(page.getByRole('heading', { level: 1, name: 'Darstellung' })).toBeVisible();
    await expect(page.getByText('Offline – Anzeigen können veraltet sein')).toBeVisible();
    await expect(page).toHaveTitle('Darstellung – Smart Home');

    await page.goto('/gibt-es-nicht');
    await expect(page.getByRole('heading', { level: 1, name: 'Nicht gefunden' })).toBeVisible();
    await expect(page.getByText('Offline – Anzeigen können veraltet sein')).toBeVisible();
  });
});

test('a chosen dark mode survives a reload of the running app', async ({ page }) => {
  await page.goto('/mehr/einstellungen/darstellung');
  await page.getByRole('radio', { name: 'Dunkel' }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Dunkel' })).toBeChecked();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
});

test.describe('without the app bundle', () => {
  // A controlling service worker would serve main-*.js from its cache and bypass page.route.
  test.use({ serviceWorkers: 'block' });

  test('the boot script applies a chosen dark mode before the app runs', async ({ page }) => {
    const surface = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-surface').trim(),
      );

    await page.goto('/mehr/einstellungen/darstellung');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    const lightSurface = await surface();
    await page.getByRole('radio', { name: 'Dunkel' }).click();
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
    const darkSurface = await surface();
    expect(darkSurface).not.toBe(lightSurface);

    await page.route(/main-[A-Z0-9]+\.js$/, (route) => route.abort());
    await page.reload();
    await expect(page.locator('app-root')).toBeEmpty();
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
    expect(await surface()).toBe(darkSurface);
  });
});

test('switching the language applies at once and is remembered', async ({ page }) => {
  await page.goto('/mehr/einstellungen/darstellung');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await page.getByRole('radio', { name: 'English' }).click();

  const englishNavigation = () => page.getByRole('navigation', { name: 'Main navigation' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectDestinations(englishNavigation(), ['Overview', 'Rooms', 'Devices', 'More']);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectDestinations(englishNavigation(), ['Overview', 'Rooms', 'Devices', 'More']);
  await expect(page.getByRole('radio', { name: 'English' })).toBeChecked();
});

test('the installation settings are reachable and show shapes and font', async ({ page }) => {
  await page.goto('/');
  await navigation(page).getByRole('link', { name: 'Mehr' }).click();
  await page.getByRole('link', { name: /Einstellungen/ }).click();
  await expect(page).toHaveURL(/\/mehr\/einstellungen$/);
  await page.getByRole('link', { name: /Erscheinungsbild der Installation/ }).click();
  await expect(page).toHaveURL(/\/mehr\/einstellungen\/installation$/);

  await expect(
    page.getByRole('heading', { level: 1, name: 'Erscheinungsbild der Installation' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Formen und Schrift' })).toBeVisible();
  // The stack test configures a soft shape and Roboto Flex for the installation.
  await expect(page.getByRole('combobox', { name: 'Formen' })).toContainText('Weich');
  await expect(page.getByRole('combobox', { name: 'Schrift' })).toContainText('Roboto Flex');
});

test('the manifest and the service worker make the app installable', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href ?? '', page.url());

  const response = await request.get(manifestUrl.href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = (await response.json()) as {
    name: string;
    icons: { src: string; type: string }[];
  };
  expect(manifest.name).toBe('Smart Home');
  expect(manifest.icons).toHaveLength(3);
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(new URL(icon.src, manifestUrl).href);
    expect(iconResponse.status(), icon.src).toBe(200);
    expect(iconResponse.headers()['content-type']).toBe(icon.type);
  }

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL('/', page.url()).href);
  expect(
    await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)),
  ).toBe(1);

  for (const file of ['/ngsw.json', '/ngsw-worker.js']) {
    const headers = (await request.get(file)).headers();
    expect(headers['cache-control'], file).toBe('no-cache');
  }
});
