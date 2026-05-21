import { defineConfig } from '@playwright/test';

const browserChannel =
  process.env.PLAYWRIGHT_BROWSER_CHANNEL === 'chrome' ? 'chrome' : undefined;

export default defineConfig({
  testDir: 'test/e2e',
  globalSetup: './test/e2e/global-setup.ts',
  workers: 4,
  use: {
    ignoreHTTPSErrors: true,
    ...(browserChannel === undefined ? {} : { channel: browserChannel }),
  },
});
