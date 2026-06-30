import assert from 'node:assert/strict';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';

import { resolveConfig, resolveOptions } from '../src/config.ts';

type SpawnCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
};

test('startCompose restarts Compose with in-memory edge and cookie secrets', async (t) => {
  const config = resolveConfig({
    ...resolveOptions({}),
    cache: '',
    root: 'compose-test',
    edgeKey: 'edge-key',
  });
  const previousCookieSecret = process.env[config.secrets.cookieSecret];
  const previousEdgeKey = process.env[config.secrets.edgeKey];
  delete process.env[config.secrets.cookieSecret];
  delete process.env[config.secrets.edgeKey];
  t.after(() => {
    if (previousCookieSecret === undefined) {
      delete process.env[config.secrets.cookieSecret];
    } else {
      process.env[config.secrets.cookieSecret] = previousCookieSecret;
    }
    if (previousEdgeKey === undefined) {
      delete process.env[config.secrets.edgeKey];
    } else {
      process.env[config.secrets.edgeKey] = previousEdgeKey;
    }
  });

  const spawnSyncCalls: SpawnCall[] = [];
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

  const { startCompose } = await import('../src/compose.ts');
  const openSyncMock = t.mock.method(fs, 'openSync', () => 2);
  syncBuiltinESMExports();
  let stop: (() => void) | undefined;

  try {
    startCompose(config);
    const firstSecret = spawnSyncCalls[1]?.env?.[config.secrets.cookieSecret];
    const firstEdgeKey = spawnSyncCalls[1]?.env?.[config.secrets.edgeKey];

    process.env[config.secrets.cookieSecret] = 'changed-cookie-secret';
    process.env[config.secrets.edgeKey] = 'changed-edge-key';
    stop = startCompose(config);
    const secondSecret = spawnSyncCalls[3]?.env?.[config.secrets.cookieSecret];
    const secondEdgeKey = spawnSyncCalls[3]?.env?.[config.secrets.edgeKey];

    assert.equal(spawnSyncCalls.length, 4);
    assert.equal(spawnSyncCalls[0]?.command, 'docker');
    assert.ok(spawnSyncCalls[0]?.args.includes('--file=./compose.yaml'));
    assert.ok(
      spawnSyncCalls[0]?.args.includes('--project-name=compose-test-visage'),
    );
    assert.deepEqual(
      spawnSyncCalls.map((call) => (call.args.includes('up') ? 'up' : 'down')),
      ['down', 'up', 'down', 'up'],
    );
    assert.deepEqual(spawnSyncCalls[1]?.args.slice(-4), [
      'up',
      '--detach',
      '--force-recreate',
      '--remove-orphans',
    ]);
    assert.equal(spawnSyncCalls[2]?.command, 'docker');
    assert.deepEqual(spawnSyncCalls[2]?.args.slice(-2), [
      'down',
      '--remove-orphans',
    ]);
    assert.ok(firstSecret);
    assert.ok(secondSecret);
    assert.notEqual(secondSecret, 'changed-cookie-secret');
    assert.equal(firstEdgeKey, 'edge-key');
    assert.equal(secondEdgeKey, 'edge-key');
    assert.notEqual(secondEdgeKey, 'changed-edge-key');

    stop();
    stop = undefined;
    assert.equal(spawnSyncCalls.length, 5);
    assert.deepEqual(spawnSyncCalls[4]?.args.slice(-2), [
      'down',
      '--remove-orphans',
    ]);
  } finally {
    stop?.();
    openSyncMock.mock.restore();
    spawnSyncMock.mock.restore();
    syncBuiltinESMExports();
  }
});

test('startCompose cleans up failed detached startup', async (t) => {
  const config = resolveConfig({
    ...resolveOptions({}),
    cache: '',
    root: 'compose-test',
    edgeKey: 'edge-key',
  });
  const spawnSyncCalls: SpawnCall[] = [];
  const spawnSyncMock = t.mock.method(childProcess, 'spawnSync', ((
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions,
  ) => {
    spawnSyncCalls.push({ command, args: args ?? [], env: options?.env });
    const isUp = args?.includes('up') === true;
    return {
      pid: 0,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: isUp ? 1 : 0,
      signal: null,
    } as SpawnSyncReturns<Buffer>;
  }) as typeof childProcess.spawnSync);
  syncBuiltinESMExports();

  const { startCompose } = await import('../src/compose.ts');
  const openSyncMock = t.mock.method(fs, 'openSync', () => 2);
  syncBuiltinESMExports();
  try {
    assert.throws(() => startCompose(config), /Failed to start Docker Compose/);

    assert.deepEqual(
      spawnSyncCalls.map((call) => (call.args.includes('up') ? 'up' : 'down')),
      ['down', 'up', 'down'],
    );
    assert.deepEqual(spawnSyncCalls[2]?.args.slice(-2), [
      'down',
      '--remove-orphans',
    ]);
  } finally {
    openSyncMock.mock.restore();
    spawnSyncMock.mock.restore();
    syncBuiltinESMExports();
  }
});
