import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  timeout: 30000,
  use: {
    browserName: 'chromium',
    launchOptions: {
      // Use an existing Chrome/Chromium installation, or Playwright's browser.
      executablePath: process.env.CHROME_BIN || undefined,
    },
    trace: 'retain-on-failure',
  },
});
