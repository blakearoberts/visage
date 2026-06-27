import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { test } from 'node:test';

import {
  createVisageMiddleware,
  createVisageUpgradeHandler,
} from '../src/middleware.ts';

type MockResponse = ServerResponse & {
  body?: string;
  ended: boolean;
};

type MockSocket = Socket & {
  chunks: string[];
  destroyed: boolean;
};

function request(headers: IncomingMessage['headers']): IncomingMessage {
  return { headers } as IncomingMessage;
}

function response(): MockResponse {
  let body: string | undefined;
  let ended = false;
  return {
    statusCode: 200,
    get ended() {
      return ended;
    },
    get body() {
      return body;
    },
    end(chunk?: unknown) {
      ended = true;
      body = typeof chunk === 'string' ? chunk : undefined;
      return this;
    },
  } as MockResponse;
}

function socket(): MockSocket {
  const chunks: string[] = [];
  let destroyed = false;
  return {
    chunks,
    write(chunk: string) {
      if (destroyed) {
        throw new Error('Cannot write to destroyed socket');
      }
      chunks.push(chunk);
      return true;
    },
    get destroyed() {
      return destroyed;
    },
    destroy() {
      destroyed = true;
      return this;
    },
  } as MockSocket;
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
  assert.equal(upgradeSocket.destroyed, false);
});

test('createVisageUpgradeHandler rejects non-edge upgrades', () => {
  const upgrade = createVisageUpgradeHandler('edge-key');
  const upgradeSocket = socket();

  upgrade(request({}), upgradeSocket);

  assert.match(upgradeSocket.chunks.join(''), /^HTTP\/1\.1 403 Forbidden/);
  assert.equal(upgradeSocket.destroyed, true);
});
