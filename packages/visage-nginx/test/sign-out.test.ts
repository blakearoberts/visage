import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sign_out } from '../src/sign-out.ts';
import type { Context } from '../src/types.ts';

describe('sign_out', () => {
  const TestRequestContext = (overrides: Partial<Context> = {}) =>
    ({
      headersOut: {},
      variables: { session_cookie_name: 'sess' },
      session: { cookie: 'sess=next' },
      ...overrides,
    }) as Context;

  test('removes outgoing cookies with the session cookie name before continuing sign-out', async (t) => {
    const request = TestRequestContext({
      headersOut: {
        'Set-Cookie': [
          'sess=next',
          'other=next; Path=/',
          'sess=next; Secure; Path=/',
          'sess=old; Path=/',
          'sess-extra=next; Path=/',
        ],
      },
    });
    const next = t.mock.fn(async () => {
      assert.equal(request.session?.cookie, 'sess=next');
      assert.deepEqual(request.headersOut['Set-Cookie'], [
        'other=next; Path=/',
        'sess-extra=next; Path=/',
      ]);
    });

    await sign_out(request, next);

    assert.equal(next.mock.callCount(), 1);
  });

  test('continues without adding a Set-Cookie header', async (t) => {
    const request = TestRequestContext();
    const next = t.mock.fn(async () => {});

    await sign_out(request, next);

    assert.equal(request.headersOut['Set-Cookie'], undefined);
    assert.equal(next.mock.callCount(), 1);
  });

  test('preserve cookies without a session', async (t) => {
    const request = TestRequestContext({
      headersOut: { 'Set-Cookie': ['sess=old'] },
      session: undefined,
    });
    const next = t.mock.fn(async () => {});

    await sign_out(request, next);

    assert.deepEqual(request.headersOut['Set-Cookie'], ['sess=old']);
    assert.equal(next.mock.callCount(), 1);
  });
});
