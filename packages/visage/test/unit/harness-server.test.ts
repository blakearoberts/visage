import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  closeServer,
  createMiddlewareServer,
  listen,
} from '../e2e/harness-server.ts';

test('createMiddlewareServer hides middleware errors from HTTP responses', async (t) => {
  const { server, use } = createMiddlewareServer();
  const error = new Error('sensitive stack marker');
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    logged.push(args);
  };
  t.after(() => {
    console.error = originalConsoleError;
  });

  use(() => {
    throw error;
  });

  try {
    await listen(server, 0);
    const address = server.address();
    assert(address !== null && typeof address !== 'string');

    const response = await fetch(`http://127.0.0.1:${address.port}/`);

    assert.equal(response.status, 500);
    assert.equal(await response.text(), 'Internal Server Error');
    assert.deepEqual(logged, [[error]]);
  } finally {
    await closeServer(server);
  }
});
