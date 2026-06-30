import { homedir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, Project } from '@playwright/test';

if (process.env.CI === 'true') {
  process.env.NODE_EXTRA_CA_CERTS = join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
    'visage/ca/rootCA.pem',
  );
}

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
  workers: process.env.CI === 'true' ? '100%' : undefined,
  projects: [
    ...addExampleSpec('plugin', 'https://localhost:9001'),
    ...addExampleSpec('server', 'https://localhost:9003'),
    ...addExampleSpec('external-idp', 'https://localhost:9002'),
  ],
  use: {
    channel: process.env.CI === 'true' ? 'chrome' : undefined,
    trace: 'on-first-retry',
    actionTimeout: 5000,
    navigationTimeout: 5000,
  },
});
