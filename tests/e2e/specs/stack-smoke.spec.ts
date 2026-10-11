import { expect, test } from '@playwright/test';

test('the app shell loads without console errors or CSP violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('app-root')).toBeAttached();
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});

test('every HTML response carries its own CSP nonce matching the page', async ({ request }) => {
  const nonces: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.get('/');
    const csp = response.headers()['content-security-policy'] ?? '';
    const headerNonce = /'nonce-([0-9a-f]{32})'/.exec(csp)?.[1];
    const bodyNonce = /ngCspNonce="([0-9a-f]{32})"/i.exec(await response.text())?.[1];
    expect(headerNonce).toBeDefined();
    expect(bodyNonce).toBe(headerNonce);
    nonces.push(headerNonce ?? '');
  }
  expect(nonces[0]).not.toBe(nonces[1]);
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
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({
        mode: 'dark',
        light: { '--mat-sys-surface': '#ffffff' },
        dark: { '--mat-sys-surface': '#101415' },
      }),
    ),
  );
  await page.route(/main-[A-Z0-9]+\.js$/, (route) => route.abort());
  await page.reload();
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
  expect(fonts.filter((url) => /figtree|atkinson/i.test(url))).toEqual([]);
});

test('a system-mode cache follows the browser color scheme before the app bundle runs', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({
        mode: 'system',
        light: { '--mat-sys-surface': '#ffffff' },
        dark: { '--mat-sys-surface': '#101415' },
      }),
    ),
  );
  await page.route(/main-[A-Z0-9]+\.js$/, (route) => route.abort());
  await page.reload();
  const surface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-surface').trim(),
  );
  expect(surface).toBe('#101415');
});
