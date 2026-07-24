import assert from 'node:assert/strict';
import type {
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from 'node:child_process';
import childProcess from 'node:child_process';
import type { PathLike } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
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
  const spawnCalls: SpawnCall[] = [];
  const stoppedLogs: unknown[] = [];
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
  const spawnMock = t.mock.method(childProcess, 'spawn', ((
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
  ) => {
    spawnCalls.push({ command, args: args ?? [], env: options?.env });
    return {
      exitCode: null,
      signalCode: null,
      kill(signal?: NodeJS.Signals | number) {
        stoppedLogs.push(signal);
        return true;
      },
    } as ReturnType<typeof childProcess.spawn>;
  }) as typeof childProcess.spawn);
  syncBuiltinESMExports();

  const { startCompose } = await import('../src/compose.ts');
  const openSyncCalls: string[] = [];
  const openSyncMock = t.mock.method(fs, 'openSync', (path: PathLike) => {
    openSyncCalls.push(String(path));
    return 2;
  });
  syncBuiltinESMExports();
  let stop: (() => void) | undefined;

  try {
    startCompose(config);
    const firstSecret = spawnSyncCalls[2]?.env?.[config.secrets.cookieSecret];
    const firstEdgeKey = spawnSyncCalls[2]?.env?.[config.secrets.edgeKey];

    process.env[config.secrets.cookieSecret] = 'changed-cookie-secret';
    process.env[config.secrets.edgeKey] = 'changed-edge-key';
    stop = startCompose(config);
    const secondSecret = spawnSyncCalls[5]?.env?.[config.secrets.cookieSecret];
    const secondEdgeKey = spawnSyncCalls[5]?.env?.[config.secrets.edgeKey];

    assert.equal(spawnSyncCalls.length, 6);
    assert.equal(spawnSyncCalls[0]?.command, 'docker');
    assert.ok(spawnSyncCalls[0]?.args.includes('--file=./compose.yaml'));
    assert.ok(
      spawnSyncCalls[0]?.args.includes('--project-name=compose-test-visage'),
    );
    assert.deepEqual(
      spawnSyncCalls.map((call) =>
        call.args.find(
          (arg) => arg === 'down' || arg === 'run' || arg === 'up',
        ),
      ),
      ['down', 'run', 'up', 'down', 'run', 'up'],
    );
    assert.deepEqual(
      spawnCalls.map((call) => call.args.slice(-2)),
      [
        ['logs', '--follow'],
        ['logs', '--follow'],
      ],
    );
    assert.deepEqual(
      openSyncCalls.map((file) => basename(file)),
      [
        'compose.log',
        'compose.log',
        'container.log',
        'compose.log',
        'compose.log',
        'container.log',
      ],
    );
    assert.deepEqual(spawnSyncCalls[1]?.args.slice(-9), [
      'run',
      '--build',
      '--quiet-build',
      '--rm',
      '--no-deps',
      'nginx',
      'nginx',
      '-t',
      '-q',
    ]);
    assert.deepEqual(spawnSyncCalls[2]?.args.slice(-4), [
      'up',
      '--detach',
      '--force-recreate',
      '--remove-orphans',
    ]);
    assert.equal(spawnSyncCalls[3]?.command, 'docker');
    assert.deepEqual(spawnSyncCalls[3]?.args.slice(-2), [
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
    assert.deepEqual(stoppedLogs, ['SIGINT']);
    assert.equal(spawnSyncCalls.length, 7);
    assert.deepEqual(spawnSyncCalls[6]?.args.slice(-2), [
      'down',
      '--remove-orphans',
    ]);
  } finally {
    stop?.();
    openSyncMock.mock.restore();
    spawnMock.mock.restore();
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
  const spawnCalls: SpawnCall[] = [];
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
  const spawnMock = t.mock.method(childProcess, 'spawn', ((
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
  ) => {
    spawnCalls.push({ command, args: args ?? [], env: options?.env });
    return {} as ReturnType<typeof childProcess.spawn>;
  }) as typeof childProcess.spawn);
  syncBuiltinESMExports();

  const { startCompose } = await import('../src/compose.ts');
  const openSyncMock = t.mock.method(fs, 'openSync', () => 2);
  syncBuiltinESMExports();
  try {
    assert.throws(() => startCompose(config), /Failed to start Docker Compose/);

    assert.deepEqual(
      spawnSyncCalls.map((call) =>
        call.args.find(
          (arg) => arg === 'down' || arg === 'run' || arg === 'up',
        ),
      ),
      ['down', 'run', 'up', 'down'],
    );
    assert.deepEqual(spawnSyncCalls[3]?.args.slice(-2), [
      'down',
      '--remove-orphans',
    ]);
    assert.equal(spawnCalls.length, 0);
  } finally {
    openSyncMock.mock.restore();
    spawnMock.mock.restore();
    spawnSyncMock.mock.restore();
    syncBuiltinESMExports();
  }
});

test('startCompose surfaces NGINX validation errors before startup', async (t) => {
  const config = resolveConfig({
    ...resolveOptions({}),
    cache: '',
    root: 'compose-test',
    edgeKey: 'edge-key',
  });
  const spawnSyncCalls: SpawnCall[] = [];
  const spawnCalls: SpawnCall[] = [];
  const spawnSyncMock = t.mock.method(childProcess, 'spawnSync', ((
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions,
  ) => {
    spawnSyncCalls.push({ command, args: args ?? [], env: options?.env });
    const isValidation = args?.includes('run') === true;
    return {
      pid: 0,
      output: [],
      stdout: '',
      stderr: isValidation ? 'nginx: configuration test failed\n' : '',
      status: isValidation ? 1 : 0,
      signal: null,
    } as SpawnSyncReturns<string>;
  }) as typeof childProcess.spawnSync);
  const spawnMock = t.mock.method(childProcess, 'spawn', ((
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
  ) => {
    spawnCalls.push({ command, args: args ?? [], env: options?.env });
    return {} as ReturnType<typeof childProcess.spawn>;
  }) as typeof childProcess.spawn);
  syncBuiltinESMExports();

  const { startCompose } = await import('../src/compose.ts');
  const openSyncMock = t.mock.method(fs, 'openSync', () => 2);
  syncBuiltinESMExports();
  try {
    assert.throws(() => startCompose(config), {
      name: 'Error',
      message: 'Failed to validate NGINX configuration',
    });

    assert.deepEqual(
      spawnSyncCalls.map((call) =>
        call.args.find(
          (arg) => arg === 'down' || arg === 'run' || arg === 'up',
        ),
      ),
      ['down', 'run'],
    );
    assert.equal(spawnCalls.length, 0);
  } finally {
    openSyncMock.mock.restore();
    spawnMock.mock.restore();
    spawnSyncMock.mock.restore();
    syncBuiltinESMExports();
  }
});
