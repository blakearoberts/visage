import { spawn, spawnSync, type StdioOptions } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from './config';

type StopCompose = () => void;

let stopRef: StopCompose | undefined;
let cookieSecret: string | undefined;

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
  const env = {
    COMPOSE_MENU: 'false',
    ...(config.oauth2.public
      ? {}
      : { [config.secrets.clientSecret]: config.oauth2.secret }),
    ...process.env,
    ...(config.edgeKey === undefined
      ? {}
      : { [config.secrets.edgeKey]: config.edgeKey }),
    [config.secrets.cookieSecret]: (cookieSecret ??=
      randomBytes(32).toString('base64url')),
  } as const;
  const opts = {
    cwd: config.cache,
    stdio: ['ignore', output, output] satisfies StdioOptions,
    env,
  };

  const up = [
    ...compose,
    'up',
    '--force-recreate',
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
