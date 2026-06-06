import { randomBytes } from 'node:crypto';

import type { NextHandleFunction } from 'connect';

import {
  cacheKeyCookie,
  type CacheKeyCookiePayload,
  type CookieCacheKey,
} from './cookie';

type Keyring = {
  readonly current: CookieCacheKey;
  readonly previous?: CookieCacheKey;
  readonly rotatedAt: number;
};

export function createSessionCacheMiddleware(): NextHandleFunction {
  const ttlMs = 30 * 1000; // 30 seconds
  const rings = new Map<string, Keyring>();

  function cookie(scope: string): string {
    const now = Date.now();
    let ring = rings.get(scope);
    if (ring === undefined || now - ring.rotatedAt >= ttlMs) {
      ring = {
        current: {
          kid: `kid_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`,
          key: randomBytes(32).toString('base64url'),
        },
        previous: ring?.current,
        rotatedAt: now,
      };
      rings.set(scope, ring);
    }

    const payload: CacheKeyCookiePayload = {
      current: ring.current,
      previous: ring.previous,
    };
    return cacheKeyCookie(
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
    );
  }

  return (request, response, next) => {
    const scope = request.headers['x-auth-request-email'];
    if (
      request.method === 'GET' &&
      (request.headers.accept ?? '').includes('text/html') &&
      request.headers['sec-fetch-mode'] === 'navigate' &&
      request.headers['sec-fetch-dest'] === 'document' &&
      typeof scope === 'string'
    ) {
      response.appendHeader('Set-Cookie', cookie(scope));
    }
    next();
  };
}
