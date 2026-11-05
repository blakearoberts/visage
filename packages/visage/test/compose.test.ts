import assert from 'node:assert/strict';
import type {
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from 'node:child_process';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { test } from 'node:test';

import { resolveConfig, resolveOptions } from '../src/config';

type SpawnCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly stdio?: SpawnSyncOptions['stdio'];
};

test('startCompose restarts Compose with in-memory edge and cookie secrets', async (t) => {
  const config = {
    ...resolveConfig({
      ...resolveOptions({
        services: { worker: { client: { secret: 'worker-secret' } } },
      }),
      cache: '',
      root: 'compose-test',
      appPort: 6173,
    }),
    package: '@blakearoberts/visage',
  };
  const previousClientSecrets = {
    VISAGE_OAUTH_CLIENT_SECRET: process.env.VISAGE_OAUTH_CLIENT_SECRET,
    VISAGE_worker_CLIENT_SECRET: process.env.VISAGE_worker_CLIENT_SECRET,
  };
  delete process.env.VISAGE_OAUTH_CLIENT_SECRET;
  delete process.env.VISAGE_worker_CLIENT_SECRET;
  t.after(() => {
    for (const [name, value] of Object.entries(previousClientSecrets)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const previousCookieSecret = process.env.OAUTH2_PROXY_COOKIE_SECRET;
  const previousEdgeKey = process.env.VISAGE_EDGE_KEY;
  delete process.env.OAUTH2_PROXY_COOKIE_SECRET;
  delete process.env.VISAGE_EDGE_KEY;
  t.after(() => {
    if (previousCookieSecret === undefined) {
      delete process.env.OAUTH2_PROXY_COOKIE_SECRET;
    } else {
      process.env.OAUTH2_PROXY_COOKIE_SECRET = previousCookieSecret;
    }
    if (previousEdgeKey === undefined) {
      delete process.env.VISAGE_EDGE_KEY;
    } else {
      process.env.VISAGE_EDGE_KEY = previousEdgeKey;
    }
  });

  const spawnSyncCalls: SpawnCall[] = [];
  const spawnCalls: SpawnCall[] = [];
  const spawnSyncMock = t.mock.method(childProcess, 'spawnSync', ((
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions,
  ) => {
    spawnSyncCalls.push({
      command,
      args: args ?? [],
      env: options?.env,
      stdio: options?.stdio,
    });
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
    return {} as ReturnType<typeof childProcess.spawn>;
  }) as typeof childProcess.spawn);
  syncBuiltinESMExports();

  const { startCompose } = await import('../src/compose');
  const openSyncCalls: string[] = [];
  const openSyncMock = t.mock.method(fs, 'openSync', (path: fs.PathLike) => {
    openSyncCalls.push(String(path));
    return 2;
  });
  syncBuiltinESMExports();
  let stop: (() => void) | undefined;

  try {
    startCompose(config);
    const firstSecret = spawnSyncCalls[2]?.env?.OAUTH2_PROXY_COOKIE_SECRET;
    const firstEdgeKey = spawnSyncCalls[2]?.env?.VISAGE_EDGE_KEY;

    process.env.OAUTH2_PROXY_COOKIE_SECRET = 'changed-cookie-secret';
    process.env.VISAGE_EDGE_KEY = 'changed-edge-key';
    process.env.VISAGE_OAUTH_CLIENT_SECRET = 'env-app-secret';
    process.env.VISAGE_worker_CLIENT_SECRET = 'env-worker-secret';
    stop = startCompose(config);
    const secondSecret = spawnSyncCalls[5]?.env?.OAUTH2_PROXY_COOKIE_SECRET;
    const secondEdgeKey = spawnSyncCalls[5]?.env?.VISAGE_EDGE_KEY;

    assert.equal(spawnSyncCalls.length, 6);
    assert.equal(spawnSyncCalls[0]?.command, 'docker');
    assert.ok(spawnSyncCalls[0]?.args.includes('--file=./compose.yaml'));
    assert.ok(
      spawnSyncCalls[0]?.args.includes(
        '--project-name=blakearoberts-visage-visage',
      ),
    );
    assert.deepEqual(
      spawnSyncCalls.map((call) =>
        call.args.find(
          (arg) => arg === 'down' || arg === 'run' || arg === 'up',
        ),
      ),
      ['down', 'run', 'up', 'down', 'run', 'up'],
    );
    assert.equal(spawnCalls.length, 0);
    assert.deepEqual(
      openSyncCalls.map((file) => basename(file)),
      [
        'compose.log',
        'compose.log',
        'compose.log',
        'compose.log',
        'compose.log',
        'compose.log',
      ],
    );
    assert.deepEqual(spawnSyncCalls[1]?.stdio, ['ignore', 2, 2]);
    assert.deepEqual(spawnSyncCalls[1]?.args.slice(-8), [
      'run',
      '--build',
      '--quiet-build',
      '--rm',
      '--no-deps',
      'nginx',
      'nginx',
      '-t',
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
    assert.ok(config.secrets.OAUTH2_PROXY_COOKIE_SECRET);
    assert.equal(firstSecret, config.secrets.OAUTH2_PROXY_COOKIE_SECRET);
    assert.equal(secondSecret, firstSecret);
    assert.equal(firstEdgeKey, config.secrets.VISAGE_EDGE_KEY);
    assert.equal(
      spawnSyncCalls[2]?.env?.VISAGE_worker_CLIENT_SECRET,
      'worker-secret',
    );
    assert.equal(
      spawnSyncCalls[2]?.env?.VISAGE_OAUTH_CLIENT_SECRET,
      config.app.client.secret,
    );
    assert.equal(
      spawnSyncCalls[5]?.env?.VISAGE_OAUTH_CLIENT_SECRET,
      'env-app-secret',
    );
    assert.equal(
      spawnSyncCalls[5]?.env?.VISAGE_worker_CLIENT_SECRET,
      'env-worker-secret',
    );
    assert.equal(secondEdgeKey, config.secrets.VISAGE_EDGE_KEY);
    assert.notEqual(secondEdgeKey, 'changed-edge-key');

    stop();
    stop = undefined;
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
    appPort: 6173,
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

  const { startCompose } = await import('../src/compose');
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
    appPort: 6173,
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

  const { startCompose } = await import('../src/compose');
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
