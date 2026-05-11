import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

type StopCompose = () => void;

let stopCompose: StopCompose | undefined;

export function startCompose(file: string): StopCompose {
  stopCompose?.();
  stopCompose = undefined;

  const stop = () => {
    if (stopCompose !== stop) return;

    stopCompose = undefined;
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
    run(file, ['down'], 'Failed to stop Docker Compose');
  };

  run(file, ['up', '-d'], 'Failed to start Docker Compose');
  stopCompose = stop;
  process.off('SIGINT', onSigInt);
  process.off('SIGTERM', onSigTerm);
  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);
  return stop;
}

function run(file: string, args: string[], message: string): void {
  const result = spawnSync('docker', ['compose', '-f', file, ...args], {
    cwd: dirname(file),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(message);
}

function onSigInt(): void {
  try {
    stopCompose?.();
  } finally {
    process.exit(130);
  }
}

function onSigTerm(): void {
  try {
    stopCompose?.();
  } finally {
    process.exit(143);
  }
}
