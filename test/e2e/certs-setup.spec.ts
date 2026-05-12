import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ensureCerts } from '../../src/certs.ts';
import { e2eCache, repo } from './environment';

test('ensureCerts prepares mkcert CA before parallel app e2e tests', async ({}, testInfo) => {
  const previous = process.env.XDG_CACHE_HOME;
  if (e2eCache !== undefined) {
    process.env.XDG_CACHE_HOME = e2eCache;
  }

  try {
    const certs = testInfo.outputPath('certs');
    await ensureCerts({
      certs,
      hostname: 'localhost',
    });

    expect(existsSync(join(certs, 'tls.crt'))).toBe(true);
    expect(existsSync(join(certs, 'tls.key'))).toBe(true);
  } finally {
    if (e2eCache !== undefined) {
      if (previous === undefined) {
        delete process.env.XDG_CACHE_HOME;
      } else {
        process.env.XDG_CACHE_HOME = previous;
      }
    }
  }
});
