import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './helpers/env';

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    // The tests read the German texts; the language tests choose their own locale.
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: /overview\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      // Reads what `devices.spec.ts` leaves behind (the simulator's gateway and its hardware in the
      // household of `theme`) and changes that person's overview layout, so it runs afterwards and
      // alone: specs in parallel never change the same household or the same person's settings.
      name: 'overview',
      testMatch: /overview\.spec\.ts/,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
