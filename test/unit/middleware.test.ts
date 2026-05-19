import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { test } from 'node:test';

import {
  createVisageMiddleware,
  createVisageUpgradeHandler,
} from '../../src/middleware.ts';

type MockResponse = ServerResponse & {
  body?: string;
  ended: boolean;
};

type MockSocket = Socket & {
  chunks: string[];
  wasDestroyed: boolean;
};

function request(headers: IncomingMessage['headers']): IncomingMessage {
  return { headers } as IncomingMessage;
}

function response(): MockResponse {
  const mock = {
    statusCode: 200,
    ended: false,
    body: undefined as string | undefined,
    end(chunk?: unknown) {
      mock.ended = true;
      mock.body = typeof chunk === 'string' ? chunk : undefined;
      return mock;
    },
  };
  return mock as MockResponse;
}

function socket(): MockSocket {
  const mock = {
    chunks: [] as string[],
    wasDestroyed: false,
    write(chunk: string) {
      mock.chunks.push(chunk);
      return true;
    },
    destroy() {
      mock.wasDestroyed = true;
      return mock;
    },
  };
  return mock as MockSocket;
}

test('createVisageMiddleware allows edge requests', () => {
  const middleware = createVisageMiddleware('edge-key');
  const res = response();
  let nextCalled = false;

  middleware(request({ 'x-visage-edge-key': 'edge-key' }), res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.ended, false);
});

test('createVisageMiddleware rejects non-edge requests', () => {
  const middleware = createVisageMiddleware('edge-key');
  const res = response();
  let nextCalled = false;

  middleware(request({}), res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body, 'Forbidden');
});

test('createVisageUpgradeHandler allows edge upgrades', () => {
  const upgrade = createVisageUpgradeHandler('edge-key');
  const upgradeSocket = socket();

  upgrade(request({ 'x-visage-edge-key': 'edge-key' }), upgradeSocket);

  assert.deepEqual(upgradeSocket.chunks, []);
  assert.equal(upgradeSocket.wasDestroyed, false);
});

test('createVisageUpgradeHandler rejects non-edge upgrades', () => {
  const upgrade = createVisageUpgradeHandler('edge-key');
  const upgradeSocket = socket();

  upgrade(request({}), upgradeSocket);

  assert.match(upgradeSocket.chunks.join(''), /^HTTP\/1\.1 403 Forbidden/);
  assert.equal(upgradeSocket.wasDestroyed, true);
});
