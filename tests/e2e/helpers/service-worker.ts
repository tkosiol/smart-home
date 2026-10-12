import { expect, type Page } from '@playwright/test';

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
    if (!controlled) {
      await page.reload();
      await page.waitForLoadState('networkidle');
    }
    expect({ controlled, normal: state.includes('Driver state: NORMAL') }).toEqual({
      controlled: true,
      normal: true,
    });
  }).toPass({ timeout, intervals: [500, 1_000, 2_000] });
}
