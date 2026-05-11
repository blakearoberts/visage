import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  workers: 2,
  use: {
    ignoreHTTPSErrors: true,
  },
});
