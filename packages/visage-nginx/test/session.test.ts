import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { session } from '../src/session.ts';
import type { Context } from '../src/types.ts';

describe('session', () => {
  const session_cookie_name = 'sess';
  const Variables = (overrides: Partial<NginxVariables> = {}) =>
    ({
      cookie_sess: 'current',
      public_origin: 'https://example.org',
      session_cookie_name,
      session_endpoint: 'https://example.org/oauth/auth',
      ...overrides,
    }) as NginxVariables;
  const TestRequestContext = (overrides: Partial<Context> = {}) =>
    ({
      variables: Variables(),
      headersOut: {},
      return(status) {
        this.status = status;
      },
      ...overrides,
    }) as Context;

  before(() => {
    Object.assign(globalThis, {
      ngx: {
        fetch: async (
          _init: never,
          options: { headers: { Cookie: string | undefined } },
        ) => {
          const cookie = options.headers.Cookie;
          const headers = new Map<string, string>();
          const accepted =
            cookie === 'sess=current' ||
            cookie === 'sess=old' ||
            cookie === 'sess=unchanged';
          if (accepted) headers.set('Authorization', 'Bearer token');
          if (cookie === 'sess=old') {
            headers.set('Set-Cookie', 'sess=next; Secure; Path=/');
          }
          if (cookie === 'sess=unchanged') {
            headers.set('Set-Cookie', 'sess-extra=next; Path=/');
          }
          if (cookie === 'sess=expired') {
            headers.set(
              'Set-Cookie',
              'sess=; Path=/; Max-Age=0; HttpOnly; Secure',
            );
          }
          return {
            status: accepted ? 202 : 401,
            headers: Object.assign(headers, {
              getAll: (name: string) => {
                const value = headers.get(name);
                return value === undefined ? [] : [value];
              },
            }),
          };
        },
      },
    });
  });

  after(() => {
    Reflect.deleteProperty(globalThis, 'ngx');
  });

  test('continues the session after successful auth check', async (t) => {
    const request = TestRequestContext();
    const next = t.mock.fn(async () => {});
    await session(request, next);

    assert.equal(next.mock.callCount(), 1);
    assert.equal(request.session?.cookie, 'sess=current');
    assert.equal(request.status, undefined);
    assert.equal(request.credential?.id_token, 'token');
    assert.equal(request.headersOut['Set-Cookie'], undefined);
  });

  test('returns 401 omitting an absent session cookie', async (t) => {
    const fetch = t.mock.method(ngx, 'fetch');
    const request = TestRequestContext({
      variables: Variables({ cookie_sess: '' }),
    });
    const next = t.mock.fn(async () => {});
    await session(request, next);

    assert.equal(next.mock.callCount(), 0);
    const [, options] = fetch.mock.calls[0].arguments;
    assert.ok(options?.headers);
    assert.equal(Object.hasOwn(options.headers, 'Cookie'), false);
    assert.equal(request.status, 401);
    assert.equal(request.headersOut['Set-Cookie'], undefined);
  });

  test('returns 401 with the deletion cookie for an expired session', async (t) => {
    const request = TestRequestContext({
      variables: Variables({ cookie_sess: 'expired' }),
    });
    const next = t.mock.fn(async () => {});
    await session(request, next);

    assert.equal(next.mock.callCount(), 0);
    assert.equal(request.status, 401);
    assert.deepEqual(request.headersOut['Set-Cookie'], [
      'sess=; Path=/; Max-Age=0; HttpOnly; Secure',
    ]);
  });

  test('keeps the current session when auth sets a different cookie', async (t) => {
    const request = TestRequestContext({
      variables: Variables({ cookie_sess: 'unchanged' }),
    });
    const next = t.mock.fn(async () => {
      assert.equal(request.session?.cookie, 'sess=unchanged');
    });

    await session(request, next);

    assert.equal(next.mock.callCount(), 1);
    assert.deepEqual(request.headersOut['Set-Cookie'], [
      'sess-extra=next; Path=/',
    ]);
  });

  test('rejects a missing session cookie name', async (t) => {
    const request = TestRequestContext({
      variables: Variables({ session_cookie_name: '' }),
    });
    const next = t.mock.fn(async () => {});
    await assert.rejects(session(request, next), {
      message: 'Missing session cookie name',
    });
    assert.equal(next.mock.callCount(), 0);
  });

  test('retains a renewed cookie and forwards Set-Cookie header', async (t) => {
    const request = TestRequestContext({
      variables: Variables({ cookie_sess: 'old' }),
    });
    const next = t.mock.fn(async () => {});
    await session(request, next);

    assert.equal(next.mock.callCount(), 1);
    assert.equal(request.session?.cookie, 'sess=next');
    assert.deepEqual(request.headersOut['Set-Cookie'], [
      'sess=next; Secure; Path=/',
    ]);
  });

  for (const [method, request_uri] of [
    ['GET', '/res/3?a=1&b=2'],
    ['HEAD', '/?'],
  ]) {
    test(`redirects unauthenticated ${method} document navigation`, async (t) => {
      const respond = t.mock.fn<Context['return']>();
      const request = TestRequestContext({
        return: respond,
        variables: Variables({
          cookie_sess: undefined,
          request_method: method,
          request_uri,
          http_sec_fetch_mode: 'navigate',
          http_sec_fetch_dest: 'document',
        }),
      });
      const next = t.mock.fn(async () => {});
      await session(request, next);

      assert.equal(next.mock.callCount(), 0);
      assert.deepEqual(respond.mock.calls[0]?.arguments, [
        302,
        'https://example.org/oauth/start?rd=' +
          encodeURIComponent('https://example.org' + request_uri),
      ]);
    });
  }

  for (const [method, mode, dest] of [
    ['POST', 'navigate', 'document'],
    ['GET', 'cors', 'document'],
    ['GET', 'navigate', 'iframe'],
  ]) {
    test(`returns 401 for unauthenticated ${method} ${mode} ${dest} requests`, async (t) => {
      const request = TestRequestContext({
        variables: Variables({
          cookie_sess: undefined,
          request_method: method,
          http_sec_fetch_mode: mode,
          http_sec_fetch_dest: dest,
        }),
      });
      const next = t.mock.fn(async () => {});
      await session(request, next);

      assert.equal(next.mock.callCount(), 0);
      assert.equal(request.status, 401);
    });
  }
});
