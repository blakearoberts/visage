import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { e2eCache, repo } from './environment';

export default function globalSetup(): void {
  const cache = join(repo, 'test-results/e2e-global-setup');
  const logs = join(cache, 'logs');
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  chmodSync(logs, 0o700);

  const config = {
    host: 'localhost',
    cache,
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

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${result.stdout}\n${result.stderr}`);
  }
}
