import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveConfig } from 'vite';

import { visage } from '../src/plugin.ts';

test('visage configures WebSockets for the HTTPS edge by default', async () => {
  const config = await resolveConfig(
    {
      configFile: false,
      plugins: [visage({ host: 'visage.test', port: 9443 })],
    },
    'serve',
  );

  assert.deepEqual(config.server.ws, {
    protocol: 'wss',
    host: 'visage.test',
    clientPort: 9443,
  });
});

test('visage preserves explicit WebSocket disabling', async () => {
  const config = await resolveConfig(
    {
      configFile: false,
      server: { ws: false },
      plugins: [visage()],
    },
    'serve',
  );

  assert.equal(config.server.ws, false);
});
