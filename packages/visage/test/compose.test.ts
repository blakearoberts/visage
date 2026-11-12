import assert from 'node:assert/strict';
import type {
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from 'node:child_process';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';

import { resolveConfig, resolveOptions } from '../src/config';

type SpawnCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
};

test('startCompose reuses generated secrets and honors environment overrides', async (t) => {
  const { startCompose } = await import('../src/compose');
  const config = resolveConfig({
    ...resolveOptions({
      services: { worker: { client: { secret: 'worker-secret' } } },
    }),
    cache: '',
    root: 'compose-test',
    appPort: 6173,
  });
  const previousSecrets = {
    VISAGE_APP_CLIENT_SECRET: process.env.VISAGE_APP_CLIENT_SECRET,
    VISAGE_WORKER_CLIENT_SECRET: process.env.VISAGE_WORKER_CLIENT_SECRET,
    OAUTH2_PROXY_COOKIE_SECRET: process.env.OAUTH2_PROXY_COOKIE_SECRET,
    VISAGE_EDGE_KEY: process.env.VISAGE_EDGE_KEY,
  };
  for (const name of Object.keys(previousSecrets)) delete process.env[name];
  t.after(() => {
    for (const [name, value] of Object.entries(previousSecrets)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const environments: (NodeJS.ProcessEnv | undefined)[] = [];
  const spawnSyncMock = t.mock.method(childProcess, 'spawnSync', ((
    _command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions,
  ) => {
    if (args?.includes('up')) environments.push(options?.env);
    return { status: 0 };
  }) as typeof childProcess.spawnSync);
  const openSyncMock = t.mock.method(fs, 'openSync', () => 2);
  syncBuiltinESMExports();

  try {
    startCompose(config);

    process.env.VISAGE_APP_CLIENT_SECRET = 'env-app-secret';
    process.env.VISAGE_WORKER_CLIENT_SECRET = 'env-worker-secret';
    startCompose(config);

    const [first, second] = environments;
    assert.ok(config.secrets.OAUTH2_PROXY_COOKIE_SECRET);
    assert.equal(
      first?.OAUTH2_PROXY_COOKIE_SECRET,
      config.secrets.OAUTH2_PROXY_COOKIE_SECRET,
    );
    assert.equal(
      second?.OAUTH2_PROXY_COOKIE_SECRET,
      first?.OAUTH2_PROXY_COOKIE_SECRET,
    );
    assert.equal(first?.VISAGE_EDGE_KEY, config.secrets.VISAGE_EDGE_KEY);
    assert.equal(second?.VISAGE_EDGE_KEY, config.secrets.VISAGE_EDGE_KEY);
    assert.equal(first?.VISAGE_APP_CLIENT_SECRET, config.app.client.secret);
    assert.equal(first?.VISAGE_WORKER_CLIENT_SECRET, 'worker-secret');
    assert.equal(second?.VISAGE_APP_CLIENT_SECRET, 'env-app-secret');
    assert.equal(second?.VISAGE_WORKER_CLIENT_SECRET, 'env-worker-secret');
  } finally {
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
      ['down', 'up', 'down'],
    );
    assert.deepEqual(spawnSyncCalls[2]?.args.slice(-2), [
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
