import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import js_access, { type Context } from '../src/index.ts';

describe('js_access', () => {
  const Variables = (overrides: Partial<NginxVariables> = {}) =>
    ({
      public_origin: 'https://example.org',
      session_endpoint: 'https://example.org/oauth/auth',
      session_cookie_name: 'sess',
      cookie_sess: 'current',
      visage_exchange: 'off',
      visage_authorization: '',
      visage_user: '',
      visage_email: '',
      visage_preferred_username: '',
      visage_groups: '',
      visage_session_cookie: '',
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

  test('skips authentication and clears outputs when policies are off', async () => {
    const request = TestRequestContext({
      variables: Variables({
        visage_session: 'off',
        visage_authorization: 'previous',
        visage_user: 'previous',
        visage_email: 'previous',
        visage_preferred_username: 'previous',
        visage_groups: 'previous',
        visage_session_cookie: 'previous',
      }),
    });
    await js_access(request);

    assert.equal(request.status, undefined);
    assert.equal(request.variables.visage_authorization, '');
    assert.equal(request.variables.visage_user, '');
    assert.equal(request.variables.visage_email, '');
    assert.equal(request.variables.visage_preferred_username, '');
    assert.equal(request.variables.visage_groups, '');
    assert.equal(request.variables.visage_session_cookie, '');
  });

  test('accepts a session without optional variables', async (t) => {
    const variables = {
      public_origin: 'https://example.org',
      session_endpoint: 'https://example.org/oauth/auth',
      session_cookie_name: 'sess',
      cookie_sess: 'current',
    };
    const request = TestRequestContext({
      variables: { ...variables } as NginxVariables,
    });
    Object.assign(globalThis, {
      ngx: {
        fetch: async () => ({
          status: 202,
          headers: new Map([['Authorization', 'Bearer id-token']]),
        }),
      },
    });
    t.after(() => {
      Reflect.deleteProperty(globalThis, 'ngx');
    });

    await js_access.session(request);

    assert.equal(request.status, undefined);
    assert.equal(request.credential?.id_token, 'id-token');
    assert.deepEqual(request.variables, variables);
  });

  for (const [forward, cookie, renewed] of [
    ['id', 'sess=current', false],
    ['access', 'sess=next', true],
  ] as const) {
    test(`publishes the session identity, cookie, and ${forward} token`, async (t) => {
      const headers = new Map([
        ['Authorization', 'Bearer id-token'],
        ['X-Auth-Request-Access-Token', 'access-token'],
        ['X-Auth-Request-User', 'user'],
        ['X-Auth-Request-Email', 'user@example.org'],
        ['X-Auth-Request-Preferred-Username', 'alice'],
        ['X-Auth-Request-Groups', 'engineering,operations'],
      ]);
      if (renewed) headers.set('Set-Cookie', cookie + '; Path=/');
      Object.assign(globalThis, {
        ngx: {
          fetch: async () => ({
            status: 202,
            headers: Object.assign(headers, {
              getAll: (name: string) => [headers.get(name)],
            }),
          }),
        },
      });
      t.after(() => {
        Reflect.deleteProperty(globalThis, 'ngx');
      });
      const request = TestRequestContext({
        variables: Variables({ visage_forward: forward }),
      });

      await js_access(request);

      assert.equal(
        request.variables.visage_authorization,
        'Bearer ' + forward + '-token',
      );
      assert.equal(request.variables.visage_user, 'user');
      assert.equal(request.variables.visage_email, 'user@example.org');
      assert.equal(request.variables.visage_preferred_username, 'alice');
      assert.equal(request.variables.visage_groups, 'engineering,operations');
      assert.equal(request.variables.visage_session_cookie, cookie);
    });
  }

  for (const [policy, variables, message] of [
    [
      'session',
      { session_cookie_name: '' },
      'Error: Missing session cookie name',
    ],
    [
      'exchange',
      { visage_session: 'off', visage_exchange: 'id' },
      'Error: Missing token exchange configuration',
    ],
  ] as const) {
    test(`returns 502 and logs the ${policy} middleware error`, async (t) => {
      const error = t.mock.fn<Context['error']>();
      const request = TestRequestContext({
        variables: Variables(variables),
        error,
      });

      await js_access(request);

      assert.deepEqual(error.mock.calls[0]?.arguments, [message]);
      assert.equal(request.status, 502);
      assert.equal(request.variables.visage_authorization, '');
    });
  }
});
