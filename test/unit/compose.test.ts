import assert from 'node:assert/strict';
import type {
  ChildProcess,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from 'node:child_process';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';

import { resolveConfig, resolveOptions } from '../../src/config.ts';

type SpawnCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
};

test('startCompose restarts Compose while preserving the cookie secret', async (t) => {
  const config = resolveConfig(resolveOptions({}), '');
  const previousCookieSecret = process.env[config.secrets.cookieSecret];
  delete process.env[config.secrets.cookieSecret];
  t.after(() => {
    if (previousCookieSecret === undefined) {
      delete process.env[config.secrets.cookieSecret];
    } else {
      process.env[config.secrets.cookieSecret] = previousCookieSecret;
    }
  });

  const spawnCalls: SpawnCall[] = [];
  const spawnSyncCalls: SpawnCall[] = [];
  const spawnMock = t.mock.method(childProcess, 'spawn', ((
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
  ) => {
    spawnCalls.push({ command, args: args ?? [], env: options?.env });
    return { kill: () => true } as ChildProcess;
  }) as typeof childProcess.spawn);
  const spawnSyncMock = t.mock.method(childProcess, 'spawnSync', ((
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions,
  ) => {
    spawnSyncCalls.push({ command, args: args ?? [], env: options?.env });
    return {
      pid: 0,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: 0,
      signal: null,
    } as SpawnSyncReturns<Buffer>;
  }) as typeof childProcess.spawnSync);
  syncBuiltinESMExports();

  const { startCompose } = await import('../../src/compose.ts');
  const openSyncMock = t.mock.method(fs, 'openSync', () => 2);
  syncBuiltinESMExports();
  let stop: (() => void) | undefined;

  try {
    startCompose(config);
    const firstSecret = spawnCalls[0]?.env?.[config.secrets.cookieSecret];

    process.env[config.secrets.cookieSecret] = 'changed-cookie-secret';
    stop = startCompose(config);
    const secondSecret = spawnCalls[1]?.env?.[config.secrets.cookieSecret];

    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[0]?.command, 'docker');
    assert.deepEqual(spawnCalls[0]?.args.slice(-3), [
      'up',
      '--force-recreate',
      '--remove-orphans',
    ]);
    assert.equal(spawnSyncCalls.length, 1);
    assert.equal(spawnSyncCalls[0]?.command, 'docker');
    assert.deepEqual(spawnSyncCalls[0]?.args.slice(-2), [
      'down',
      '--remove-orphans',
    ]);
    assert.ok(firstSecret);
    assert.equal(secondSecret, firstSecret);
    assert.notEqual(secondSecret, 'changed-cookie-secret');

    stop();
    stop = undefined;
    assert.equal(spawnSyncCalls.length, 2);
  } finally {
    stop?.();
    openSyncMock.mock.restore();
    spawnMock.mock.restore();
    spawnSyncMock.mock.restore();
    syncBuiltinESMExports();
  }
});
