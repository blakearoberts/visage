import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  resolveConfig,
  resolveOptions,
  resolveViteUpstream,
  VisageEdgeKeyHeader,
  type VisageConfig,
} from '../../src/config.ts';
import type { VisageOptions } from '../../src/types.ts';

function tempCache(t: TestContext) {
  const cache = mkdtempSync(join(tmpdir(), 'visage-config-test-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  return cache;
}

function resolveForTest(
  t: TestContext,
  options: VisageOptions = {},
): { cache: string; config: VisageConfig } {
  const cache = tempCache(t);
  return {
    cache,
    config: resolveConfig(
      resolveOptions({
        host: 'app.local.test',
        port: 9443,
        ...options,
        upstreams: {
          vite: resolveViteUpstream({ port: 6173 }),
          ...options.upstreams,
        },
      }),
      cache,
    ),
  };
}

test('resolveOptions applies public defaults', () => {
  const options = resolveOptions({});

  assert.equal(options.host, 'localhost');
  assert.equal(options.port, 9001);
  assert.deepEqual(options.cookie, {
    cookie_name: '__Host-sess',
    cookie_expire: '8h',
    cookie_refresh: '15m',
    cookie_path: '/',
    cookie_secret_file: '/etc/oauth2-proxy/cookie-secret',
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
    emailDomains: ['example.com'],
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
    cookie_secret_file: '/etc/oauth2-proxy/cookie-secret',
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
      emailDomains: ['example.test', 'admin.example.test'],
    },
  });

  assert.deepEqual(options.oauth2, {
    id: 'local-app',
    secret: 'local-secret',
    scopes: ['openid', 'email'],
    emailDomains: ['example.test', 'admin.example.test'],
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
  assert.equal(options.upstreams.api.scheme, 'https');
  assert.equal(options.upstreams.api.port, 443);
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
          locations: { '/api/': { auth: { forward: 'access' } } },
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
      external: {},
      externalHttp: {
        scheme: 'http',
      },
    },
  });

  assert.deepEqual(options.services.api, {
    image: 'example/api:test',
    upstream: {
      port: 8080,
      locations: { '/api/': { auth: { forward: 'access' } } },
    },
  });
  assert.equal(options.upstreams.api.host, 'api.local.test');
  assert.deepEqual(options.upstreams.api.locations, { '/api/': {} });
  assert.equal(options.upstreams.api.scheme, 'http');
  assert.equal(options.upstreams.api.port, 9000);
  assert.equal(options.upstreams.whoami.host, 'whoami');
  assert.deepEqual(options.upstreams.whoami.locations, { '/whoami/': {} });
  assert.equal(options.upstreams.whoami.scheme, 'http');
  assert.equal(options.upstreams.whoami.port, 80);
  assert.equal(options.upstreams.secure.host, 'secure');
  assert.equal(options.upstreams.secure.scheme, 'https');
  assert.equal(options.upstreams.secure.port, 443);
  assert.equal(options.upstreams.external.host, 'external');
  assert.equal(options.upstreams.external.scheme, 'https');
  assert.equal(options.upstreams.external.port, 443);
  assert.equal(options.upstreams.externalHttp.host, 'externalHttp');
  assert.equal(options.upstreams.externalHttp.scheme, 'http');
  assert.equal(options.upstreams.externalHttp.port, 80);
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
    emailDomains: ['example.com'],
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
  assert.deepEqual(config.idp.upstream, {
    idp: {
      host: 'idp.localhost',
      locations: {},
      scheme: 'http',
      port: 5557,
    },
  });
  assert.equal(config.idp.oidc.issuer, 'http://idp.localhost:5557/idp');
  assert.equal(config.idp.oidc.end_session_endpoint, undefined);
  assert.equal('authorization' in config.idp, false);
  assert.equal('token' in config.idp, false);
  assert.equal('jwks' in config.idp, false);
});

test('resolveConfig supports external IdP end-session endpoints', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      issuer: 'http://idp.localhost:5557/idp',
      end_session_endpoint: 'http://idp.localhost:5557/idp/logout',
    },
  });

  assert.equal(
    config.idp.oidc.end_session_endpoint,
    'http://idp.localhost:5557/idp/logout',
  );
  assert.equal(
    config.upstreams.oauth2_proxy.locations['/oauth2/sign_out'].headers[
      'X-Auth-Request-Redirect'
    ],
    '"http://idp.localhost:5557/idp/logout?id_token_hint={id_token}&post_logout_redirect_uri=https%3A%2F%2Fapp.local.test%3A9443%2F"',
  );
});

test('resolveConfig uses issuer scheme for external IdP upstream defaults', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      issuer: 'https://idp.example.test/idp',
    },
  });

  assert.equal(config.upstreams.idp.scheme, 'https');
  assert.equal(config.upstreams.idp.port, 443);
  assert.deepEqual(config.upstreams.idp.locations, {});
  assert.equal('authorization' in config.idp, false);
  assert.equal('token' in config.idp, false);
  assert.equal('jwks' in config.idp, false);
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
  assert.equal(config.idp.oidc.issuer, 'https://idp.example.test');
  assert.ok('authorization' in config.idp.oidc);
  assert.equal(
    config.idp.oidc.authorization,
    'https://idp.example.test/oauth2/v2/authorize?prompt=login',
  );
  assert.equal(
    config.idp.oidc.token,
    'https://idp.example.test/oauth2/v2/token',
  );
  assert.equal(config.idp.oidc.jwks, 'https://idp.example.test/oauth2/v2/jwks');
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
  const { cache, config } = resolveForTest(t, {
    upstreams: {
      api: {
        host: 'api',
        port: 8080,
        locations: {
          '/api/': {
            auth: { forward: 'access' },
            headers: {
              Host: 'api.internal',
              'X-Service': 'api',
            },
            directives: {
              proxy_buffer_size: '16k',
              proxy_hide_header: ['X-A', 'X-B'],
            },
          },
        },
      },
      metrics: {},
    },
  });

  assert.equal(config.host, 'app.local.test');
  assert.equal(config.port, 9443);
  assert.equal(config.cache, cache);
  assert.equal(config.idp.oidc.end_session_endpoint, undefined);
  assert.equal(config.upstreams.vite.scheme, 'http');
  assert.equal(config.upstreams.dex.port, 5556);
  assert.equal(config.upstreams.dex.scheme, 'http');
  assert.equal(config.upstreams.oauth2_proxy.port, 4180);
  assert.equal(config.upstreams.oauth2_proxy.scheme, 'http');
  assert.deepEqual(config.network, {
    name: process.env.COMPOSE_PROJECT_NAME ?? 'visage',
    trustedProxyIps: [],
  });

  assert.deepEqual(config.upstreams.api.locations['/api/'].auth, {
    enabled: true,
    forward: 'access',
    redirect: false,
  });
  assert.equal(config.upstreams.api.locations['/api/'].csrf, 'api');
  assert.deepEqual(config.upstreams.api.locations['/api/'].headers, {
    Cookie: '""',
    'X-Auth-Request-User': '""',
    'X-Auth-Request-Email': '""',
    'X-Auth-Request-Groups': '""',
    'X-Auth-Request-Preferred-Username': '""',
    Authorization: '"Bearer $access_token"',
    Host: 'api.internal',
    'X-Real-IP': '$remote_addr',
    'X-Forwarded-For': '$proxy_add_x_forwarded_for',
    'X-Forwarded-Proto': '$scheme',
    'X-Service': 'api',
  });
  assert.deepEqual(config.upstreams.api.locations['/api/'].directives, {
    proxy_buffer_size: ['16k'],
    proxy_hide_header: ['X-A', 'X-B'],
  });
  assert.equal(config.upstreams.metrics.host, 'metrics');
  assert.deepEqual(config.upstreams.metrics.locations['/metrics/'].auth, {
    enabled: true,
    forward: false,
    redirect: false,
  });
  assert.equal(config.upstreams.metrics.locations['/metrics/'].csrf, 'api');
  assert.deepEqual(config.upstreams.metrics.locations['/metrics/'].directives, {
    proxy_buffer_size: ['8k'],
  });
  assert.equal(
    config.upstreams.metrics.locations['/metrics/'].headers?.Host,
    'metrics',
  );
  assert.equal(config.upstreams.metrics.scheme, 'https');
  assert.equal(config.upstreams.metrics.port, 443);
  assert.equal(
    config.upstreams.vite.locations['/'].headers?.['X-Auth-Request-User'],
    '$auth_user',
  );
  assert.equal(
    config.upstreams.vite.locations['/'].headers?.['X-Auth-Request-Email'],
    '$auth_email',
  );
});

test('resolveViteUpstream injects the edge key into Vite locations', () => {
  const upstream = resolveViteUpstream(
    {
      locations: {
        '/': {
          headers: {
            'X-App': 'root',
          },
        },
        '/app/': {
          headers: {
            'X-App': 'nested',
          },
        },
      },
    },
    'edge-key',
  );

  assert.equal(
    upstream.locations?.['/']?.headers?.[VisageEdgeKeyHeader],
    'edge-key',
  );
  assert.equal(
    upstream.locations?.['/app/']?.headers?.[VisageEdgeKeyHeader],
    'edge-key',
  );
  assert.equal(upstream.locations?.['/']?.headers?.['X-App'], 'root');
  assert.equal(upstream.locations?.['/app/']?.headers?.['X-App'], 'nested');
});

test('resolveViteUpstream preserves explicit edge key overrides', () => {
  const upstream = resolveViteUpstream(
    {
      locations: {
        '/': {
          headers: {
            [VisageEdgeKeyHeader]: 'overridden',
          },
        },
        '/app/': {
          headers: {
            [VisageEdgeKeyHeader]: 'nested-override',
          },
        },
      },
    },
    'edge-key',
  );

  assert.equal(
    upstream.locations?.['/']?.headers?.[VisageEdgeKeyHeader],
    'overridden',
  );
  assert.equal(
    upstream.locations?.['/app/']?.headers?.[VisageEdgeKeyHeader],
    'nested-override',
  );
});

test('resolveConfig resolves automatic token forwarding by upstream kind', (t) => {
  const { config } = resolveForTest(t, {
    services: {
      api: {
        image: 'example/api:test',
        upstream: {
          locations: { '/api/': { auth: { forward: true } } },
        },
      },
    },
    upstreams: {
      external: {
        locations: { '/external/': { auth: { forward: true } } },
      },
      vite: {
        locations: { '/': { auth: { forward: true } } },
      },
    },
  });

  assert.equal(config.upstreams.api.locations['/api/'].auth.forward, 'id');
  assert.equal(
    config.upstreams.external.locations['/external/'].auth.forward,
    'access',
  );
  assert.equal(config.upstreams.vite.locations['/'].auth.forward, 'id');
});

test('resolveConfig applies CSRF defaults and overrides', (t) => {
  const { config } = resolveForTest(t, {
    upstreams: {
      api: {
        locations: {
          '/api/': {},
          '/app/': { csrf: 'app' },
          '/webhook/': { auth: { enabled: false } },
          '/custom/': { csrf: false },
        },
      },
    },
  });

  assert.equal(config.upstreams.vite.locations['/'].csrf, 'app');
  assert.equal(config.upstreams.api.locations['/api/'].csrf, 'api');
  assert.equal(config.upstreams.api.locations['/app/'].csrf, 'app');
  assert.equal(config.upstreams.api.locations['/webhook/'].csrf, false);
  assert.equal(config.upstreams.api.locations['/custom/'].csrf, false);
  assert.equal(config.upstreams.dex.locations['/dex/'].csrf, false);
  assert.equal(config.upstreams.oauth2_proxy.locations['/oauth2/'].csrf, false);
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
            auth: { redirect: true, forward: 'access' },
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
    restart: 'always',
  });
  assert.deepEqual(config.services.api, {
    image: 'example/api:test',
    command: ['serve'],
    restart: 'on-failure',
  });
  assert.equal(config.upstreams.api.host, 'backend');
  assert.deepEqual(Object.keys(config.upstreams.api.locations), ['/api/']);
  assert.equal(config.upstreams.api.locations['/api/'].headers?.Host, '$host');

  assert.equal(config.upstreams.vite.host, 'vite');
  assert.equal(config.upstreams.vite.port, 3000);
  assert.deepEqual(Object.keys(config.upstreams.vite.locations), ['/app/']);
  assert.deepEqual(config.upstreams.vite.locations['/app/'].auth, {
    enabled: true,
    forward: 'access',
    redirect: true,
  });
  assert.equal(config.upstreams.vite.locations['/app/'].headers?.Cookie, '""');
  assert.equal(config.upstreams.vite.locations['/app/'].headers?.Host, 'vite');
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers?.Upgrade,
    '$http_upgrade',
  );
});
