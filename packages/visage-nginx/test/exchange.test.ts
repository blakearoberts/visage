import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, mock, test } from 'node:test';

import { exchange } from '../src/exchange.ts';
import type { Context } from '../src/types.ts';

describe('exchange', () => {
  const Variables = (overrides: Partial<NginxVariables> = {}) =>
    ({
      public_origin: 'https://edge.example.org',
      upstream_origin: 'https://resource.example.org',
      exchange_endpoint: 'https://issuer.example.org/token',
      exchange_connector: 'session-issuer',
      visage_exchange: 'id',
      visage_forward: 'access',
      ...overrides,
    }) as NginxVariables;

  const TestRequestContext = (overrides: Partial<Context> = {}) =>
    ({
      variables: Variables(),
      credential: { id_token: 'session-id', access_token: 'session-access' },
      ...overrides,
    }) as Context;

  before(() => {
    mock.method(fs, 'readFileSync', () => 'test:secret');
  });

  after(() => mock.restoreAll());

  test('exchanges id token for access token', async (t) => {
    const request = TestRequestContext({
      variables: Variables({ visage_exchange: 'id', visage_forward: 'access' }),
    });
    const fetch = async (_url: string, options: { body: string }) => {
      const body = Object.fromEntries(new URLSearchParams(options.body));
      assert.partialDeepStrictEqual(body, {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        scope: 'audience:server:client_id:https://resource.example.org',
        subject_token: 'session-id',
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      });
      return {
        status: 200,
        json: async () => ({
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          token_type: 'Bearer',
          access_token: 'issued-access',
        }),
      };
    };
    Object.assign(globalThis, { ngx: { fetch } });
    t.after(() => {
      Reflect.deleteProperty(globalThis, 'ngx');
    });
    const next = t.mock.fn(async () => {});

    await exchange(request, next);

    assert.equal(next.mock.callCount(), 1);
    assert.equal(request.credential?.access_token, 'issued-access');
  });

  test('exchanges access token for id token', async (t) => {
    const request = TestRequestContext({
      variables: Variables({ visage_exchange: 'access', visage_forward: 'id' }),
    });
    const fetch = async (_url: string, options: { body: string }) => {
      const body = Object.fromEntries(new URLSearchParams(options.body));
      assert.partialDeepStrictEqual(body, {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        scope: 'audience:server:client_id:https://resource.example.org',
        subject_token: 'session-access',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      });
      return {
        status: 200,
        json: async () => ({
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'N_A',
          access_token: 'issued-id',
        }),
      };
    };
    Object.assign(globalThis, { ngx: { fetch } });
    t.after(() => {
      Reflect.deleteProperty(globalThis, 'ngx');
    });
    const next = t.mock.fn(async () => {});

    await exchange(request, next);

    assert.equal(next.mock.callCount(), 1);
    assert.equal(request.credential?.id_token, 'issued-id');
  });

  test('stops when the session lacks a subject token', async (t) => {
    const request = TestRequestContext({
      credential: { access_token: 'session-access' },
    });
    const fetch = t.mock.fn();
    Object.assign(globalThis, { ngx: { fetch } });
    t.after(() => {
      Reflect.deleteProperty(globalThis, 'ngx');
    });
    const next = t.mock.fn(async () => {});

    await assert.rejects(exchange(request, next), {
      message: 'Missing token exchange configuration',
    });

    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(next.mock.callCount(), 0);
  });

  test('preserves the session when denied exchange', async (t) => {
    const respond = t.mock.fn<Context['return']>();
    const request = TestRequestContext({ return: respond });
    const credential = { ...request.credential };
    const fetch = t.mock.fn(async () => ({ status: 400 }));
    Object.assign(globalThis, { ngx: { fetch } });
    t.after(() => {
      Reflect.deleteProperty(globalThis, 'ngx');
    });
    const next = t.mock.fn(async () => {});

    await exchange(request, next);

    assert.deepEqual(respond.mock.calls[0]?.arguments, [400]);
    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(request.credential, credential);
    assert.equal(next.mock.callCount(), 0);
  });
});
