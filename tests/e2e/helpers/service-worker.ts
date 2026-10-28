import { expect, type Page, type Request } from '@playwright/test';

/** The live stream of a signed-in page: it stays open for as long as the page does. */
const isLiveStream = (request: Request): boolean => request.url().endsWith('/events');

/**
 * Reloads the page and waits until it is idle: no request but the live stream is pending for half
 * a second. `waitForLoadState('networkidle')` cannot do this, since the stream never ends.
 */
async function reloadUntilIdle(page: Page): Promise<void> {
  let pending = 0;
  let lastChange = Date.now();
  const change = (delta: number) => (request: Request) => {
    if (isLiveStream(request)) return;
    pending += delta;
    lastChange = Date.now();
  };
  const started = change(1);
  const ended = change(-1);
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  try {
    await page.reload();
    await expect(async () => {
      expect(pending <= 0 && Date.now() - lastChange >= 500).toBe(true);
    }).toPass({ timeout: 10_000, intervals: [100] });
  } finally {
    page.off('request', started);
    page.off('requestfinished', ended);
    page.off('requestfailed', ended);
  }
}

/**
 * Loads `/` and waits until the service worker is installed and in control of the page, with the
 * app shell cached: the first load is never controlled (the worker registers once the app is
 * stable), so the page is reloaded until it is. Bounded by `timeout` instead of a fixed wait.
 */
export async function loadWithServiceWorkerInControl(page: Page, timeout = 45_000): Promise<void> {
  await page.goto('/');
  await expect(async () => {
    const { controlled, state } = await page.evaluate(async () => ({
      controlled: navigator.serviceWorker.controller !== null,
      state: await (await fetch('/ngsw/state')).text(),
    }));
    if (!controlled) await reloadUntilIdle(page);
    expect({ controlled, normal: state.includes('Driver state: NORMAL') }).toEqual({
      controlled: true,
      normal: true,
    });
  }).toPass({ timeout, intervals: [500, 1_000, 2_000] });
}
