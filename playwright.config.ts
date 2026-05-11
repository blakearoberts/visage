import { defineConfig } from '@playwright/test';

const browserChannel =
  process.env.PLAYWRIGHT_BROWSER_CHANNEL === 'chrome' ? 'chrome' : undefined;

export default defineConfig({
  testDir: 'test/e2e',
  workers: 2,
  projects: [
    {
      name: 'certs-setup',
      testMatch: /certs-setup\.spec\.ts/,
    },
    {
      name: 'e2e',
      dependencies: ['certs-setup'],
      testIgnore: /certs-setup\.spec\.ts/,
    },
  ],
  use: {
    ignoreHTTPSErrors: true,
    ...(browserChannel === undefined ? {} : { channel: browserChannel }),
  },
});
