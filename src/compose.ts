import { spawn, spawnSync, StdioOptions } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';

type StopCompose = () => void;

let stopRef: StopCompose | undefined;

export function startCompose(file: string): StopCompose {
  stopRef?.();
  stopRef = undefined;

  const logs = join(dirname(file), 'logs');
  mkdirSync(logs, { recursive: true });
  const output = openSync(join(logs, 'compose.log'), 'w');

  const compose = [
    'compose',
    `--project-name=${process.env.COMPOSE_PROJECT_NAME ?? 'visage'}`,
    `--file=${file}`,
  ] as const;
  const env = { ...process.env, COMPOSE_MENU: 'false' } as const;
  const opts = {
    cwd: dirname(file),
    stdio: ['ignore', output, output] satisfies StdioOptions,
    env,
  };

  const up = [
    ...compose,
    'up',
    '--abort-on-container-failure',
    '--no-color',
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
