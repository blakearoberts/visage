import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from './config';

export function startCompose(config: VisageConfig): () => void {
  const compose = [
    'compose',
    '--ansi=never',
    `--file=${config.files.compose}`,
    `--project-name=${config.compose.name}`,
    `--profile=${process.platform}`,
  ];
  const dir = join(config.cache, 'logs');
  const env = {
    COMPOSE_MENU: 'false',
    ...(config.oauth2.public
      ? {}
      : { [config.secrets.clientSecret]: config.oauth2.secret }),
    ...process.env,
    [config.secrets.edgeKey]: config.edgeKey,
    [config.secrets.cookieSecret]: randomBytes(32).toString('base64url'),
  };
  const opts = { cwd: config.cache, env };

  function up() {
    const out = openSync(join(dir, 'compose.log'), 'w');
    const args = [
      ...compose,
      'up',
      '--detach',
      '--force-recreate',
      '--remove-orphans',
    ];
    return spawnSync('docker', args, { ...opts, stdio: ['ignore', out, out] });
  }
  function down() {
    const out = openSync(join(dir, 'compose.log'), 'w');
    const args = [...compose, 'down', '--remove-orphans'];
    return spawnSync('docker', args, { ...opts, stdio: ['ignore', out, out] });
  }
  function follow() {
    const out = openSync(join(dir, 'container.log'), 'w');
    const args = [...compose, 'logs', '--follow'];
    return spawn('docker', args, { ...opts, stdio: ['ignore', out, out] });
  }

  down();
  const result = up();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    down();
    throw new Error('Failed to start Docker Compose');
  }
  const logs = follow();
  return () => {
    down();
    logs.kill('SIGINT');
  };
}
