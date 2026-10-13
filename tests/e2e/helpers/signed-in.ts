import { test as base, type Page } from '@playwright/test';

/**
 * TEMPORARY (stage 4a, task 8): the stack has no user and no mail catcher yet, so the pages are
 * opened as a fixed signed-in user: `GET /api/v1/me` is answered by Playwright, and the same user
 * is put into the device copy (`smart.me`) before every page load so that the offline start finds
 * it. Task 10 replaces this with a real sign-in through the e-mail code.
 */
export const E2E_ME = {
  id: '5d7c6c8e-0000-4000-8000-000000000001',
  email: 'e2e@example.org',
  displayName: 'E2E',
  locale: 'de',
  appearance: { mode: 'system', contrast: 'system' },
  isPlatformAdmin: false,
};

export async function stubSignedInUser(page: Page): Promise<void> {
  await page.addInitScript((me) => {
    localStorage.setItem('smart.me', JSON.stringify(me));
  }, E2E_ME);
  // On the context: once the service worker controls the page, its requests no longer reach page.route.
  await page.context().route('**/api/v1/me', (route) => route.fulfill({ json: E2E_ME }));
}

/** `test` whose `page` is signed in as the fixed user (see above). */
export const test = base.extend({
  page: async ({ page }, use) => {
    await stubSignedInUser(page);
    await use(page);
  },
});
