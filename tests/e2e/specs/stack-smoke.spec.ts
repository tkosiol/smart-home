import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadWithServiceWorkerInControl } from '../helpers/service-worker';

test('every page renders without console errors or CSP violations', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' });
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
  for (const [link, heading] of [
    ['Räume', 'Räume'],
    ['Geräte', 'Geräte'],
    ['Mehr', 'Mehr'],
    ['Übersicht', 'Übersicht'],
  ] as const) {
    await navigation.getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }

  await navigation.getByRole('link', { name: 'Mehr' }).click();
  await page.getByRole('link', { name: /Einstellungen/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
  await page.getByRole('link', { name: /Darstellung/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Darstellung' })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: /Erscheinungsbild der Installation/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Erscheinungsbild der Installation' }),
  ).toBeVisible();

  await page.goto('/gibt-es-nicht');
  await expect(page.getByRole('heading', { level: 1, name: 'Nicht gefunden' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});

for (const [locale, lang] of [
  ['en-US', 'en'],
  ['de-DE', 'de'],
  ['fr-FR', 'de'],
] as const) {
  test(`a browser preferring ${locale} gets the page language ${lang}`, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await context.close();
  });
}

test('the CSP keeps scripts strict and allows inline styles', async ({ request }) => {
  const csp = (await request.get('/')).headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self';");
  expect(csp).toContain("style-src 'self' 'unsafe-inline';");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
});

test('index.html is served byte-for-byte as the service worker manifest expects', async ({
  request,
}) => {
  const manifest = (await (await request.get('/ngsw.json')).json()) as {
    hashTable: Record<string, string>;
  };
  const body = await (await request.get('/index.html')).body();
  expect(createHash('sha1').update(body).digest('hex')).toBe(manifest.hashTable['/index.html']);
});

test('the service worker installs and controls the page after a reload', async ({ page }) => {
  await loadWithServiceWorkerInControl(page);

  const state = await page.evaluate(async () => (await fetch('/ngsw/state')).text());
  expect(state).toContain('Driver state: NORMAL');
});

for (const path of ['/', '/devices/123', '/api/health/live']) {
  test(`security headers are present on ${path}`, async ({ request }) => {
    const headers = (await request.get(path)).headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toBe('max-age=31536000');
  });
}

test('hashed assets are cacheable and keep the security headers', async ({ page, request }) => {
  await page.goto('/');
  const script = await page.locator('script[src*="main-"]').first().getAttribute('src');
  expect(script).toBeTruthy();
  const headers = (await request.get(script ?? '')).headers();
  expect(headers['cache-control']).toContain('immutable');
  expect(headers['x-content-type-options']).toBe('nosniff');
});

test('hashed font files are cacheable for a year', async ({ page, request }) => {
  await page.goto('/');
  const stylesheet = await page
    .locator('link[rel="stylesheet"][href*="styles-"]')
    .getAttribute('href');
  expect(stylesheet).toBeTruthy();
  const css = await (await request.get(`/${stylesheet}`)).text();
  const font = /url\(["']?(?:\.\/)?(media\/[^"')]+\.woff2)["']?\)/.exec(css)?.[1];
  expect(font, 'a self-hosted woff2 in the global styles').toBeTruthy();
  const response = await request.get(`/${font}`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('theme-boot.js is revalidated on every load and keeps the security headers', async ({
  request,
}) => {
  const response = await request.get('/theme-boot.js');
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['cache-control']).toBe('no-cache');
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['x-content-type-options']).toBe('nosniff');
});

test('deep links fall back to the app shell', async ({ request }) => {
  const response = await request.get('/devices/123');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
});

test('the API is reachable through the web container and ready', async ({ request }) => {
  const response = await request.get('/api/health/ready');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', checks: { database: 'up', broker: 'up' } });
});

test('unknown API routes answer 404 instead of the app shell', async ({ request }) => {
  expect((await request.get('/api/does-not-exist')).status()).toBe(404);
});

test('a stored dark theme applies even before the app bundle runs', async ({ page }) => {
  // Seeded before any page script: a running app would rewrite the cache after a first load.
  await page.addInitScript((mode) => {
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({
        v: 2,
        mode,
        followsSystemContrast: false,
        light: { '--mat-sys-surface': '#ffffff' },
        dark: { '--mat-sys-surface': '#101415' },
      }),
    );
  }, 'dark');
  await page.route(/main-[A-Z0-9]+\.js$/, (route) => route.abort());
  await page.goto('/');
  const surface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-surface').trim(),
  );
  expect(surface).toBe('#101415');
});

test('the generated default theme colors the page without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary').trim(),
  );
  expect(primary).toMatch(/^#[0-9a-f]{6}$/);
  await context.close();
});

test('only the active font family is downloaded', async ({ page }) => {
  const fonts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fonts.push(request.url());
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // The stack's instance font is Roboto Flex: it is requested, the other families are not.
  expect(fonts.filter((url) => /roboto-flex/i.test(url)).length).toBeGreaterThan(0);
  expect(fonts.filter((url) => /figtree|atkinson/i.test(url))).toEqual([]);
});

test('a system-mode cache follows the browser color scheme before the app bundle runs', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  // Seeded before any page script: a running app would rewrite the cache after a first load.
  await page.addInitScript((mode) => {
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({
        v: 2,
        mode,
        followsSystemContrast: false,
        light: { '--mat-sys-surface': '#ffffff' },
        dark: { '--mat-sys-surface': '#101415' },
      }),
    );
  }, 'system');
  await page.route(/main-[A-Z0-9]+\.js$/, (route) => route.abort());
  await page.goto('/');
  const surface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-surface').trim(),
  );
  expect(surface).toBe('#101415');
});

/** Set via SMART_INSTANCE_APPEARANCE in infra/compose/test/compose.test.yaml. */
const STACK_TEST_INSTANCE = {
  colors: { seed: '#6e4c7e', variant: 'tonalSpot', colorMatch: false, coreOverrides: {} },
  shape: 'weich',
  font: 'roboto-flex',
};

test('config.json comes from the container environment and is never cached', async ({
  request,
}) => {
  const response = await request.get('/config.json');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(await response.json()).toEqual({
    features: { instanceAppearanceEditor: true },
    instanceAppearance: STACK_TEST_INSTANCE,
  });
});

test('the instance default from config.json replaces the build default', async ({
  browser,
  page,
}) => {
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noScript.newPage();
  await staticPage.goto('/');
  const buildDefault = await staticPage.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary').trim(),
  );
  await noScript.close();

  await page.goto('/');
  // The ThemeService writes its variables inline on <html> once the app runs.
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--mat-sys-primary')),
    )
    .not.toBe('');
  const applied = await page.evaluate(() => ({
    primary: getComputedStyle(document.documentElement)
      .getPropertyValue('--mat-sys-primary')
      .trim(),
    corner: getComputedStyle(document.documentElement)
      .getPropertyValue('--mat-sys-corner-medium')
      .trim(),
  }));
  expect(applied.primary).not.toBe(buildDefault);
  expect(applied.corner).toBe('18px');
});
