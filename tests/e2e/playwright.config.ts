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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
