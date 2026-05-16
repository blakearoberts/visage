import { spawn, spawnSync, StdioOptions } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from './config';

type StopCompose = () => void;

let stopRef: StopCompose | undefined;

export function startCompose(config: VisageConfig): StopCompose {
  stopRef?.();
  stopRef = undefined;

  const file = join(config.cache, config.files.compose);
  const logs = join(config.cache, 'logs');
  const output = openSync(join(logs, 'compose.log'), 'w');

  const compose = [
    'compose',
    '--ansi=never',
    `--file=${file}`,
    `--project-name=${process.env.COMPOSE_PROJECT_NAME ?? 'visage'}`,
  ] as const;
  const env = { ...process.env, COMPOSE_MENU: 'false' } as const;
  const opts = {
    cwd: config.cache,
    stdio: ['ignore', output, output] satisfies StdioOptions,
    env,
  };

  const up = [
    ...compose,
    'up',
    '--abort-on-container-failure',
    '--remove-orphans',
  ] as const;
  const child = spawn('docker', up, opts);

  const stop = () => {
    if (stopRef !== stop) return;
    stopRef = undefined;

    child.kill();
    const down = [...compose, 'down', '--remove-orphans'] as const;
    spawnSync('docker', down, opts);
  };

  stopRef = stop;
  return stop;
}
