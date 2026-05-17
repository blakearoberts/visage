import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { e2eCache, repo } from './environment';

test('ensureCerts prepares mkcert CA before parallel app e2e tests', async ({}, testInfo) => {
  const config = {
    host: 'localhost',
    cache: testInfo.outputDir,
    files: { certs: ['./certs'] },
  };
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      [
        "import { ensureCerts } from './src/certs.ts';",
        `await ensureCerts(${JSON.stringify(config)});`,
      ].join('\n'),
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(e2eCache === undefined ? {} : { XDG_CACHE_HOME: e2eCache }),
      },
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stdout}\n${result.stderr}`);
  }

  const certs = testInfo.outputPath('certs');
  expect(existsSync(join(certs, 'tls.crt'))).toBe(true);
  expect(existsSync(join(certs, 'tls.key'))).toBe(true);
});
