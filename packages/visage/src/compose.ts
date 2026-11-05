import { spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from './config';

export function startCompose(config: VisageConfig): () => void {
  const compose = [
    'compose',
    '--ansi=never',
    `--file=${config.files.compose}`,
    `--project-name=${config.package
      .toLowerCase()
      .replace(/^[^a-z0-9]+/, '')
      .replace(/[^a-z0-9_-]+/g, '-')}-visage`,
    `--profile=${process.platform}`,
  ];
  const dir = join(config.cache, 'logs');
  const env = {
    COMPOSE_MENU: 'false',
    ...config.secrets,
    ...process.env,
  };
  const opts = { cwd: config.cache, env };

  function validate() {
    const out = openSync(join(dir, 'compose.log'), 'a');
    const args = [
      ...compose,
      'run',
      '--build',
      '--quiet-build',
      '--rm',
      '--no-deps',
      'nginx',
      'nginx',
      '-t',
    ];
    const result = spawnSync('docker', args, {
      ...opts,
      stdio: ['ignore', out, out],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error('Failed to validate NGINX configuration');
    }
  }
  function up() {
    const out = openSync(join(dir, 'compose.log'), 'a');
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
    const out = openSync(join(dir, 'compose.log'), 'a');
    const args = [...compose, 'down', '--remove-orphans'];
    return spawnSync('docker', args, { ...opts, stdio: ['ignore', out, out] });
  }

  down();
  validate();
  const result = up();
  if (result.error || result.status !== 0) {
    down();
    throw result.error ?? new Error('Failed to start Docker Compose');
  }
  return down;
}
