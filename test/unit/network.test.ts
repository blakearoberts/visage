import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';

import { resolveConfig, resolveOptions } from '../../src/config.ts';

test('ensureNginxNetwork appends inspected Compose subnets to configured trusted proxies', async (t) => {
  const spawnSyncMock = t.mock.method(childProcess, 'spawnSync', ((
    command: string,
    args?: readonly string[],
  ) => {
    assert.equal(command, 'docker');
    if (args?.[1] === 'ls') {
      return {
        stdout: 'test-app-visage\n',
        stderr: '',
        status: 0,
      };
    }
    if (args?.[1] === 'inspect') {
      return {
        stdout: '172.30.0.0/16\n172.31.0.0/16\n',
        stderr: '',
        status: 0,
      };
    }
    throw new Error(`Unexpected docker command: ${args?.join(' ')}`);
  }) as typeof childProcess.spawnSync);
  syncBuiltinESMExports();

  try {
    const { ensureNginxNetwork } = await import('../../src/network.ts');
    const config = resolveConfig({
      ...resolveOptions({}),
      root: 'test-app',
      cache: '',
      edgeKey: 'edge-key',
    });

    const result = ensureNginxNetwork({
      ...config,
      compose: {
        ...config.compose,
        network: {
          trustedProxyIps: ['10.0.0.0/8'],
        },
      },
    });

    assert.deepEqual(result.compose.network.trustedProxyIps, [
      '10.0.0.0/8',
      '172.30.0.0/16',
      '172.31.0.0/16',
    ]);
  } finally {
    spawnSyncMock.mock.restore();
    syncBuiltinESMExports();
  }
});
