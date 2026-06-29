import { spawnSync, type StdioOptions } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from './config';

export function startCompose(config: VisageConfig): () => void {
  const logs = join(config.cache, 'logs');
  const output = openSync(join(logs, 'compose.log'), 'w');

  const compose = [
    'compose',
    '--ansi=never',
    `--file=${config.files.compose}`,
    `--project-name=${config.compose.name}`,
  ] as const;

  const env = {
    COMPOSE_MENU: 'false',
    ...(config.oauth2.public
      ? {}
      : { [config.secrets.clientSecret]: config.oauth2.secret }),
    ...process.env,
    [config.secrets.edgeKey]: config.edgeKey,
    [config.secrets.cookieSecret]: randomBytes(32).toString('base64url'),
  } as const;
  const opts = {
    cwd: config.cache,
    stdio: ['ignore', output, output] satisfies StdioOptions,
    env,
  };

  function up() {
    const args = [
      ...compose,
      'up',
      '--detach',
      '--force-recreate',
      '--remove-orphans',
    ] as const;
    return spawnSync('docker', args, opts);
  }

  function down() {
    const args = [...compose, 'down', '--remove-orphans'] as const;
    return spawnSync('docker', args, opts);
  }

  down();
  const result = up();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    down();
    throw new Error('Failed to start Docker Compose');
  }
  return down;
}
