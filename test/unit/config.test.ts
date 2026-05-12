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

  assert.equal(options.host, 'localhost');
  assert.equal(options.port, 9001);
  assert.deepEqual(options.cookie, {
    cookie_name: '__Host-session',
    cookie_expire: '8h',
    cookie_refresh: '15m',
    cookie_path: '/',
  });
  assert.deepEqual(options.idp, {
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

  assert.equal(options.cookie.cookie_name, '__Host-custom');
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
      issuer: 'http://idp.localhost:5557/idp',
    },
  });

  assert.deepEqual(options.idp, {
    issuer: 'http://idp.localhost:5557/idp',
    authorization: '/auth',
    token: '/token',
    jwks: '/keys',
  });
});

test('resolveOptions applies upstream defaults', () => {
  const options = resolveOptions({
    upstreams: {
      api: {},
      secure: {
        scheme: 'https',
      },
    },
  });

  assert.equal(options.upstreams.api.host, 'api');
  assert.deepEqual(options.upstreams.api.locations, { '/api/': {} });
  assert.equal(options.upstreams.api.scheme, 'http');
  assert.equal(options.upstreams.api.port, 80);
  assert.equal(options.upstreams.secure.host, 'secure');
  assert.deepEqual(options.upstreams.secure.locations, { '/secure/': {} });
  assert.equal(options.upstreams.secure.scheme, 'https');
  assert.equal(options.upstreams.secure.port, 443);
});

test('resolveOptions derives upstreams from services', () => {
  const options = resolveOptions({
    services: {
      api: {
        image: 'example/api:test',
        upstream: {
          port: 8080,
          locations: { '/api/': { auth: { forward: false } } },
        },
      },
      whoami: {
        image: 'traefik/whoami',
      },
      secure: {
        image: 'example/secure:test',
        upstream: {
          scheme: 'https',
        },
      },
    },
    upstreams: {
      api: {
        host: 'api.local.test',
        port: 9000,
      },
      external: {
        scheme: 'https',
      },
    },
  });

  assert.deepEqual(options.services.api, { image: 'example/api:test' });
  assert.equal(options.upstreams.api.host, 'api.local.test');
  assert.deepEqual(options.upstreams.api.locations, { '/api/': {} });
  assert.equal(options.upstreams.api.port, 9000);
  assert.equal(options.upstreams.whoami.host, 'whoami');
  assert.deepEqual(options.upstreams.whoami.locations, { '/whoami/': {} });
  assert.equal(options.upstreams.whoami.port, 80);
  assert.equal(options.upstreams.secure.host, 'secure');
  assert.equal(options.upstreams.secure.scheme, 'https');
  assert.equal(options.upstreams.secure.port, 443);
  assert.equal(options.upstreams.external.host, 'external');
  assert.equal(options.upstreams.external.scheme, 'https');
  assert.equal(options.upstreams.external.port, 443);
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
  assert.deepEqual(config.upstreams.idp.locations, {});
  assert.equal(config.idp.upstream, 'idp');
  assert.equal(config.idp.issuer, 'http://idp.localhost:5557/idp');
  assert.equal(config.idp.authorization, 'http://idp.localhost:5557/idp/auth');
  assert.equal(config.idp.token, 'http://idp.localhost:5557/idp/token');
  assert.equal(config.idp.jwks, 'http://idp.localhost:5557/idp/keys');
});

test('resolveConfig uses upstream scheme for external IdP endpoint defaults', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      issuer: 'https://idp.example.test/idp',
    },
  });

  assert.equal(config.upstreams.idp.scheme, 'https');
  assert.equal(config.upstreams.idp.port, 443);
  assert.deepEqual(config.upstreams.idp.locations, {});
  assert.equal(config.idp.token, 'https://idp.example.test/idp/token');
  assert.equal(config.idp.jwks, 'https://idp.example.test/idp/keys');
});

test('resolveConfig omits external IdP upstream locations for root issuer paths', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      issuer: 'https://idp.example.test',
      authorization: '/oauth2/v2/authorize?prompt=login',
      token: '/oauth2/v2/token',
      jwks: '/oauth2/v2/jwks',
    },
  });

  assert.equal(config.upstreams.idp.host, 'idp.example.test');
  assert.equal(config.upstreams.idp.scheme, 'https');
  assert.equal(config.upstreams.idp.port, 443);
  assert.deepEqual(config.upstreams.idp.locations, {});
  assert.equal(
    config.idp.authorization,
    'https://idp.example.test/oauth2/v2/authorize?prompt=login',
  );
  assert.equal(config.idp.token, 'https://idp.example.test/oauth2/v2/token');
  assert.equal(config.idp.jwks, 'https://idp.example.test/oauth2/v2/jwks');
});

test('resolveConfig preserves managed service defaults for partial service overrides', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
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
      metrics: {},
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
  assert.equal(config.upstreams.metrics.host, 'metrics');
  assert.deepEqual(config.upstreams.metrics.locations['/metrics/'].auth, {
    enabled: true,
    forward: true,
    redirect: false,
  });
  assert.equal(
    config.upstreams.metrics.locations['/metrics/'].headers.Host,
    'metrics',
  );
  assert.equal(config.upstreams.metrics.scheme, 'http');
  assert.equal(config.upstreams.metrics.port, 80);
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
        upstream: {
          host: 'backend',
          locations: { '/api/': {} },
        },
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
  assert.equal(config.upstreams.api.host, 'backend');
  assert.deepEqual(Object.keys(config.upstreams.api.locations), ['/api/']);
  assert.equal(config.upstreams.api.locations['/api/'].headers.Host, '$host');

  assert.equal(config.upstreams.vite.host, 'vite');
  assert.equal(config.upstreams.vite.port, 3000);
  assert.deepEqual(Object.keys(config.upstreams.vite.locations), ['/app/']);
  assert.deepEqual(config.upstreams.vite.locations['/app/'].auth, {
    enabled: true,
    forward: false,
    redirect: true,
  });
  assert.equal(config.upstreams.vite.locations['/app/'].headers.Cookie, '""');
  assert.equal(config.upstreams.vite.locations['/app/'].headers.Host, 'vite');
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers.Upgrade,
    '$http_upgrade',
  );
});
