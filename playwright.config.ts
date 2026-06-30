import { defineConfig, Project } from '@playwright/test';

function addExampleSpec(
  name: string,
  baseURL?: string,
  dependencies: string[] = [],
): Project<unknown, unknown>[] {
  const setup = `${name}.setup`;
  const teardown = `${name}.teardown`;
  return [
    {
      name: setup,
      testMatch: `${setup}.ts`,
      teardown,
      dependencies,
    },
    {
      name: teardown,
      testMatch: `${teardown}.ts`,
    },
    ...(baseURL
      ? [
          {
            name,
            use: { baseURL },
            testMatch: `${name}.spec.ts`,
            dependencies: [setup],
          },
        ]
      : []),
  ] as const;
}

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  workers: process.env.CI ? '100%' : undefined,
  projects: [
    ...addExampleSpec('plugin', 'https://localhost:9001'),
    ...addExampleSpec('server', 'https://localhost:9003'),
    ...addExampleSpec('external-idp', 'https://localhost:9002'),
  ],
  use: {
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    actionTimeout: 5000,
    navigationTimeout: 5000,
  },
});
