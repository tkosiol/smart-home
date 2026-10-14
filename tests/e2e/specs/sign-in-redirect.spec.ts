import { expect, test } from '@playwright/test';

// No sign-in stub here: the stack has no session, so the API answers 401 and the guard applies.
// The real sign-in with the e-mailed code is tested in auth.spec.ts (task 10).
test('an anonymous visitor lands on the sign-in page and keeps the wanted page', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto('/mehr/einstellungen');
  await expect(page).toHaveURL(/\/anmelden\?ziel=%2Fmehr%2Feinstellungen$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeVisible();
  await expect(page).toHaveTitle('Anmelden – Smart Home');
  await expect(page.getByRole('textbox', { name: 'E-Mail-Adresse' })).toHaveAttribute(
    'autocomplete',
    'email',
  );
  await expect(page.getByRole('button', { name: 'Code senden' })).toBeVisible();
  // The frame with the navigation is not part of the sign-in page.
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  // The 401 of the first "who am I" request is expected; nothing else may fail.
  expect(problems.filter((text) => !text.includes('401'))).toEqual([]);
});
