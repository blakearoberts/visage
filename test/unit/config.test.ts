import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { resolveConfig, resolveOptions } from '../../src/config.ts';

function tempCache(t) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'visage-config-test-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  return cacheDir;
}

function resolveForTest(t, options = {}) {
  const cacheDir = tempCache(t);
  return {
    cacheDir,
    config: resolveConfig(
      resolveOptions({
        host: 'app.local.test',
        port: 9443,
        ...options,
      }),
      { cacheDir },
      6173,
    ),
  };
}

test('resolveOptions applies public defaults', () => {
  const options = resolveOptions({});

  assert.equal(options.host, 'local.vite.app');
  assert.equal(options.port, 9001);
  assert.deepEqual(options.cookie, {
    cookie_name: '__HOST-session',
    cookie_expire: '8h',
    cookie_refresh: '15m',
    cookie_path: '/',
  });
  assert.deepEqual(options.idp, {
    kind: 'dex',
    dex: {
      users: [
        {
          email: 'user@example.com',
          password: 'pass',
          username: 'user',
          userID: 'user@example.com',
        },
      ],
    },
  });
  assert.deepEqual(options.oauth2, {
    id: 'visage',
    secret: 'visage-secret',
    scopes: ['openid', 'email', 'profile', 'offline_access'],
    public: false,
  });
});

test('resolveOptions prefixes host-only cookie names', () => {
  const options = resolveOptions({ cookie: { name: 'custom' } });

  assert.equal(options.cookie.cookie_name, '__HOST-custom');
});

test('resolveOptions applies cookie overrides', () => {
  const options = resolveOptions({
    cookie: {
      name: 'custom',
      expire: '30m',
      refresh: '5m',
      domains: ['.local.test', 'app.local.test'],
      path: '/app/',
    },
  });

  assert.deepEqual(options.cookie, {
    cookie_name: 'custom',
    cookie_expire: '30m',
    cookie_refresh: '5m',
    cookie_domains: ['.local.test', 'app.local.test'],
    cookie_path: '/app/',
  });
});

test('resolveOptions applies Dex overrides', () => {
  const options = resolveOptions({
    idp: {
      expiry: {
        idTokens: '10m',
        authRequests: '2m',
        refreshTokens: {
          validIfNotUsedFor: '1h',
          absoluteLifetime: '8h',
          reuseInterval: '10s',
        },
      },
      users: [
        {
          email: 'admin@example.com',
          password: 'secret',
        },
        {
          email: 'reader@example.com',
          password: 'reader-password',
          username: 'reader',
          userID: 'reader-1',
        },
      ],
    },
  });

  assert.deepEqual(options.idp, {
    kind: 'dex',
    dex: {
      expiry: {
        idTokens: '10m',
        authRequests: '2m',
        refreshTokens: {
          validIfNotUsedFor: '1h',
          absoluteLifetime: '8h',
          reuseInterval: '10s',
        },
      },
      users: [
        {
          email: 'admin@example.com',
          password: 'secret',
          username: 'admin',
          userID: 'admin@example.com',
        },
        {
          email: 'reader@example.com',
          password: 'reader-password',
          username: 'reader',
          userID: 'reader-1',
        },
      ],
    },
  });
});

test('resolveOptions applies OAuth2 client overrides', () => {
  const options = resolveOptions({
    oauth2: {
      clientId: 'local-app',
      clientSecret: 'local-secret',
      scopes: ['openid', 'email'],
    },
  });

  assert.deepEqual(options.oauth2, {
    id: 'local-app',
    secret: 'local-secret',
    scopes: ['openid', 'email'],
    public: false,
  });
});

test('resolveOptions applies IdP overrides', () => {
  const options = resolveOptions({
    idp: {
      kind: 'external',
      issuer: 'http://idp.localhost:5557/idp',
    },
  });

  assert.deepEqual(options.idp, {
    kind: 'external',
    issuer: 'http://idp.localhost:5557/idp',
    authorization: '/auth',
    token: '/token',
    jwks: '/keys',
  });
});

test('resolveOptions applies upstream scheme defaults', () => {
  const options = resolveOptions({
    upstreams: {
      api: {
        host: 'api',
        port: 8080,
      },
      secure: {
        host: 'secure',
        scheme: 'https',
        port: 443,
      },
    },
  });

  assert.equal(options.upstreams.api.scheme, 'http');
  assert.equal(options.upstreams.secure.scheme, 'https');
});

test('resolveOptions supports OAuth2 public PKCE clients', () => {
  const options = resolveOptions({
    oauth2: {
      clientId: 'local-app',
      clientSecret: null,
      scopes: ['openid', 'email', 'profile', 'offline_access'],
    },
  });

  assert.deepEqual(options.oauth2, {
    id: 'local-app',
    scopes: ['openid', 'email', 'profile', 'offline_access'],
    public: true,
  });
});

test('resolveConfig supports external IdP upstreams', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      kind: 'external',
      issuer: 'http://idp.localhost:5557/idp',
    },
  });

  assert.equal(config.services.dex, undefined);
  assert.deepEqual(config.services.nginx.depends_on, ['oauth2_proxy']);
  assert.deepEqual(config.services.nginx.extra_hosts, [
    'host.docker.internal:host-gateway',
  ]);
  assert.equal(config.services.oauth2_proxy.depends_on, undefined);
  assert.deepEqual(config.services.oauth2_proxy.extra_hosts, [
    'host.docker.internal:host-gateway',
  ]);
  assert.equal(config.upstreams.dex, undefined);
  assert.equal(config.upstreams.idp.host, 'idp.localhost');
  assert.equal(config.upstreams.idp.scheme, 'http');
  assert.equal(config.upstreams.idp.port, 5557);
  assert.deepEqual(config.upstreams.idp.locations['/idp'].auth, {
    enabled: false,
    forward: true,
    redirect: false,
  });
  assert.equal(config.idp.kind, 'external');
  assert.equal(config.idp.upstream, 'idp');
  assert.equal(config.idp.issuer, 'http://idp.localhost:5557/idp');
  assert.equal(config.idp.authorization, 'http://idp.localhost:5557/idp/auth');
  assert.equal(config.idp.token, 'http://idp.localhost:5557/idp/token');
  assert.equal(config.idp.jwks, 'http://idp.localhost:5557/idp/keys');
});

test('resolveConfig uses upstream scheme for external IdP endpoint defaults', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      kind: 'external',
      issuer: 'https://idp.example.test/idp',
    },
  });

  assert.equal(config.upstreams.idp.scheme, 'https');
  assert.equal(config.upstreams.idp.port, 443);
  assert.equal(config.idp.token, 'https://idp.example.test/idp/token');
  assert.equal(config.idp.jwks, 'https://idp.example.test/idp/keys');
});

test('resolveConfig preserves managed service defaults for partial service overrides', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      kind: 'external',
      issuer: 'http://idp.localhost:5557/idp',
    },
    services: {
      nginx: {
        extra_hosts: ['idp.localhost:host-gateway'],
      },
      oauth2_proxy: {
        extra_hosts: ['idp.localhost:host-gateway'],
      },
    },
  });

  assert.deepEqual(config.services.nginx.extra_hosts, [
    'host.docker.internal:host-gateway',
    'idp.localhost:host-gateway',
  ]);
  assert.deepEqual(config.services.oauth2_proxy.command, [
    '--config',
    '/etc/oauth2-proxy/config.yml',
  ]);
  assert.deepEqual(config.services.oauth2_proxy.extra_hosts, [
    'host.docker.internal:host-gateway',
    'idp.localhost:host-gateway',
  ]);
});

test('resolveConfig applies defaults and normalizes upstream locations', (t) => {
  const { cacheDir, config } = resolveForTest(t, {
    upstreams: {
      api: {
        host: 'api',
        port: 8080,
        locations: {
          '/api/': {
            auth: { forward: false },
            headers: {
              Host: 'api.internal',
              'X-Service': 'api',
            },
          },
        },
      },
      metrics: {
        host: 'metrics',
        port: 9090,
      },
    },
  });

  assert.equal(config.host, 'app.local.test');
  assert.equal(config.port, 9443);
  assert.equal(config.cache, join(cacheDir, 'visage'));
  assert.equal(config.services.dex.image, 'ghcr.io/dexidp/dex:v2.45.1');
  assert.equal(config.upstreams.vite.scheme, 'http');
  assert.equal(config.upstreams.dex.port, 5556);
  assert.equal(config.upstreams.dex.scheme, 'http');

  assert.deepEqual(config.upstreams.api.locations['/api/'].auth, {
    enabled: true,
    forward: false,
    redirect: false,
  });
  assert.deepEqual(config.upstreams.api.locations['/api/'].headers, {
    Cookie: '""',
    Host: 'api.internal',
    'X-Real-IP': '$remote_addr',
    'X-Forwarded-For': '$proxy_add_x_forwarded_for',
    'X-Forwarded-Proto': '$scheme',
    'X-Service': 'api',
  });
  assert.deepEqual(config.upstreams.metrics.locations, {});
  assert.equal(config.upstreams.metrics.scheme, 'http');
});

test('resolveConfig lets named services and upstreams override base entries', (t) => {
  const { config } = resolveForTest(t, {
    services: {
      nginx: {
        image: 'custom-nginx:test',
        depends_on: ['api'],
      },
      api: {
        image: 'example/api:test',
        command: ['serve'],
      },
    },
    upstreams: {
      vite: {
        host: 'vite',
        port: 3000,
        locations: {
          '/app/': {
            auth: { redirect: true, forward: false },
            headers: {
              Upgrade: '$http_upgrade',
            },
          },
        },
      },
    },
  });

  assert.deepEqual(config.services.nginx, {
    image: 'custom-nginx:test',
    depends_on: ['api'],
    extra_hosts: ['host.docker.internal:host-gateway'],
  });
  assert.deepEqual(config.services.api, {
    image: 'example/api:test',
    command: ['serve'],
  });

  assert.equal(config.upstreams.vite.host, 'vite');
  assert.equal(config.upstreams.vite.port, 3000);
  assert.deepEqual(Object.keys(config.upstreams.vite.locations), ['/app/']);
  assert.deepEqual(config.upstreams.vite.locations['/app/'].auth, {
    enabled: true,
    forward: false,
    redirect: true,
  });
  assert.equal(config.upstreams.vite.locations['/app/'].headers.Cookie, '""');
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers.Upgrade,
    '$http_upgrade',
  );
});
