import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  resolveConfig,
  resolveOptions,
  VisageEdgeKeyHeader,
  type VisageConfig,
} from '../src/config';
import type { VisageOptions } from '../src/types';

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
    config: resolveConfig({
      ...resolveOptions({
        host: 'app.local.test',
        port: 9443,
        ...options,
      }),
      cache,
      root: 'test-app',
      edgeKey: 'edge-key',
      appPort: 6173,
    }),
  };
}

test('resolveOptions applies public defaults', () => {
  const options = resolveOptions({});

  assert.equal(options.host, 'localhost');
  assert.equal(options.port, 9001);
  assert.equal(options.telemetry, false);
  assert.equal(options.services.otelcol, undefined);
  assert.equal(options.remotes.otelcol, undefined);
  assert.deepEqual(options.cookie, {
    cookie_name: '__Host-sess',
    cookie_expire: '720h',
    cookie_refresh: '30s',
    cookie_path: '/',
  });
  assert.ok('dex' in options.idp);
  assert.deepEqual(options.idp.dex, {
    expiry: {
      idTokens: '1m',
      refreshTokens: {
        reuseInterval: '1s',
        validIfNotUsedFor: '720h',
        absoluteLifetime: '720h',
      },
    },
    sessions: { absoluteLifetime: '720h', validIfNotUsedFor: '720h' },
    users: [
      {
        email: 'user@example.com',
        password: 'visage-password',
        username: 'user',
        userID: 'user@example.com',
      },
    ],
  });
  assert.deepEqual(options.oauth2, {
    id: 'visage',
    secret: 'visage-secret',
    scopes: ['openid', 'offline_access'],
    public: false,
    redirectUri: 'https://localhost:9001/oauth2/callback',
    postLogoutRedirectUri: 'https://localhost:9001/oauth2/start?rd=/',
  });
});

test('resolution keeps service overrides in options and assembles defaults in config', (t) => {
  const services = {
    dex: {
      environment: { EXAMPLE: 'value' },
      upstream: { headers: { 'X-Example': 'value' } },
    },
  };
  const options = resolveOptions({
    telemetry: true,
    services,
  });
  assert.deepEqual(options.services, services);
  assert.equal(options.remotes.vite, undefined);

  const config = resolveConfig({
    ...options,
    root: 'test-app',
    cache: tempCache(t),
    edgeKey: 'edge-key',
    appPort: 6173,
  });
  for (const [name, port] of [
    ['dex', 5556],
    ['oauth2_proxy', 4180],
    ['otelcol', 4318],
  ] as const) {
    assert.ok(config.services[name].upstream);
    assert.equal(config.services[name].upstream.port, port);
  }
  assert.deepEqual(config.services.dex.environment, {
    DEX_SESSIONS_ENABLED: 'true',
    EXAMPLE: 'value',
  });
  assert.ok(config.services.dex.upstream);
  assert.equal(
    config.services.dex.upstream.locations['/dex/'].headers['X-Example'],
    'value',
  );
  assert.deepEqual(options.services, services);
  assert.equal(options.remotes.vite, undefined);
  assert.equal('upstreams' in config, false);
});

test('resolveOptions preserves Dex defaults with partial overrides', () => {
  const options = resolveOptions({
    idp: {
      expiry: { refreshTokens: { reuseInterval: '2s' } },
      sessions: { absoluteLifetime: '1440h' },
    },
  });

  assert.ok('dex' in options.idp);
  assert.deepEqual(options.idp.dex.expiry, {
    idTokens: '1m',
    refreshTokens: {
      reuseInterval: '2s',
      validIfNotUsedFor: '720h',
      absoluteLifetime: '720h',
    },
  });
  assert.deepEqual(options.idp.dex.sessions, {
    absoluteLifetime: '1440h',
    validIfNotUsedFor: '720h',
  });
});

test('resolveConfig enables the managed OpenTelemetry Collector', (t) => {
  const { config } = resolveForTest(t, { telemetry: {} });

  assert.equal(config.telemetry, true);
  for (const name of ['nginx', 'oauth2_proxy', 'dex', 'otelcol']) {
    assert.deepEqual(config.services[name].logging, {
      driver: 'fluentd',
      options: {
        'fluentd-address': '127.0.0.1:24224',
        'fluentd-async': 'true',
        'cache-disabled': 'true',
        tag: `test-app/${name}|{{.ImageName}}`,
      },
    });
  }
  assert.equal(config.services.otelcol.depends_on, undefined);
  assert.equal(config.services.otelcol.network_mode, undefined);
  assert.deepEqual(config.services.otelcol.environment, {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'host.docker.internal:4317',
  });
  assert.equal(config.services.nginx.environment, undefined);
  assert.ok(config.services.otelcol.upstream);
  assert.equal(config.services.otelcol.upstream.host, 'otelcol');
  assert.equal(config.services.otelcol.upstream.port, 4318);
  assert.deepEqual(config.services.otelcol.upstream.locations['/t/'].auth, {
    enabled: true,
    forward: false,
  });
  assert.deepEqual(
    config.services.otelcol.upstream.locations['/t/'].directives,
    {
      proxy_buffer_size: ['8k'],
      proxy_connect_timeout: ['5s'],
      proxy_read_timeout: ['5s'],
      proxy_send_timeout: ['5s'],
      rewrite: ['^/t/(.*)$ /$1 break'],
    },
  );
});

test('resolveConfig preserves loopback service overrides', (t) => {
  const service = { image: 'custom/socat', command: ['custom'], profiles: [] };
  const { config } = resolveForTest(t, {
    services: { vite_loopback: service },
  });
  assert.equal(config.services.vite_loopback.image, service.image);
  assert.deepEqual(config.services.vite_loopback.command, service.command);
  assert.deepEqual(config.services.vite_loopback.profiles, service.profiles);
});

test('resolveConfig uses each bound port without changing resolved options', (t) => {
  const options = resolveOptions({});
  for (const appPort of [6176, 6177]) {
    const config = resolveConfig({
      ...options,
      root: 'test-app',
      cache: tempCache(t),
      edgeKey: 'edge-key',
      appPort,
    });
    assert.equal(config.app.upstream.port, appPort);
    assert.equal(config.app.upstream.host, 'host.docker.internal');
    assert.deepEqual(Object.keys(config.app.upstream.locations), ['/']);
    assert.equal(
      config.services.vite_loopback.command,
      `tcp-listen:${appPort},fork,bind=host.docker.internal ` +
        `tcp-connect:127.0.0.1:${appPort}`,
    );
  }
  assert.equal(options.remotes.vite, undefined);
  assert.deepEqual(options.services, {});
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
      sessions: { absoluteLifetime: '8760h', validIfNotUsedFor: '8760h' },
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

  assert.ok('dex' in options.idp);
  assert.deepEqual(options.idp.dex, {
    sessions: { absoluteLifetime: '8760h', validIfNotUsedFor: '8760h' },
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
    redirectUri: 'https://localhost:9001/oauth2/callback',
    postLogoutRedirectUri: 'https://localhost:9001/oauth2/start?rd=/',
  });
});

test('resolveOptions applies IdP overrides', () => {
  const options = resolveOptions({
    idp: {
      issuer: 'http://idp.localhost:5557/idp',
      algs: ['RS512'],
    },
  });

  assert.deepEqual(options.idp.oidc, {
    issuer: 'http://idp.localhost:5557/idp',
    algs: ['RS512'],
  });
});

test('resolveConfig applies upstream defaults', (t) => {
  const { config } = resolveForTest(t, {
    remotes: {
      api: {},
      secure: {
        scheme: 'https',
      },
    },
  });

  assert.equal(config.remotes.api.host, 'api');
  assert.equal(config.remotes.api.scheme, 'https');
  assert.equal(config.remotes.api.port, 443);
  assert.equal(config.remotes.secure.host, 'secure');
  assert.equal(config.remotes.secure.scheme, 'https');
  assert.equal(config.remotes.secure.port, 443);
});

test('resolveConfig applies upstream headers to every location', (t) => {
  const { config } = resolveForTest(t, {
    remotes: {
      api: {
        headers: {
          Host: 'api.internal',
          'X-Service': 'api',
          'X-Scope': 'upstream',
        },
        locations: {
          '/api/': {},
          '/admin/': {
            headers: {
              'X-Scope': 'admin',
            },
          },
        },
      },
    },
  });

  assert.equal(
    config.remotes.api.locations['/api/'].headers.Host,
    'api.internal',
  );
  assert.equal(
    config.remotes.api.locations['/api/'].headers['X-Service'],
    'api',
  );
  assert.equal(
    config.remotes.api.locations['/api/'].headers['X-Scope'],
    'upstream',
  );
  assert.equal(
    config.remotes.api.locations['/admin/'].headers['X-Service'],
    'api',
  );
  assert.equal(
    config.remotes.api.locations['/admin/'].headers['X-Scope'],
    'admin',
  );
});

test('resolveConfig derives upstreams from services', (t) => {
  const { config } = resolveForTest(t, {
    services: {
      api: {
        image: 'example/api:test',
        upstream: {
          host: 'api.local.test',
          port: 9000,
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
    remotes: {
      external: {},
      externalHttp: {
        scheme: 'http',
      },
    },
  });

  const { upstream: apiUpstream, ...apiService } = config.services.api;
  assert.ok(apiUpstream);
  assert.deepEqual(apiService, {
    image: 'example/api:test',
    restart: 'on-failure',
  });
  assert.equal(apiUpstream.host, 'api.local.test');
  assert.equal(apiUpstream.scheme, 'http');
  assert.equal(apiUpstream.port, 9000);
  assert.ok(config.services.whoami.upstream);
  assert.equal(config.services.whoami.upstream.host, 'whoami');
  assert.equal(config.services.whoami.upstream.scheme, 'http');
  assert.equal(config.services.whoami.upstream.port, 80);
  assert.ok(config.services.secure.upstream);
  assert.equal(config.services.secure.upstream.host, 'secure');
  assert.equal(config.services.secure.upstream.scheme, 'https');
  assert.equal(config.services.secure.upstream.port, 443);
  assert.equal(config.remotes.external.host, 'external');
  assert.equal(config.remotes.external.scheme, 'https');
  assert.equal(config.remotes.external.port, 443);
  assert.equal(config.remotes.externalHttp.host, 'externalHttp');
  assert.equal(config.remotes.externalHttp.scheme, 'http');
  assert.equal(config.remotes.externalHttp.port, 80);
});

test('resolveConfig skips automatic upstreams disabled by service configuration', (t) => {
  const { config } = resolveForTest(t, {
    services: { worker: { image: 'example/worker', upstream: false } },
  });

  assert.equal(config.services.worker.upstream, undefined);
  assert.equal(config.services.nginx.upstream, undefined);
  assert.equal(config.services.vite_loopback.upstream, undefined);
  assert.equal(config.services.worker.image, 'example/worker');
  assert.equal(config.services.worker.restart, 'on-failure');
});

test('resolveConfig rejects remotes sharing a service name even when its upstream is disabled', (t) => {
  for (const upstream of [undefined, false, {}] as const) {
    assert.throws(
      () =>
        resolveForTest(t, {
          services: { api: { image: 'example/api', upstream } },
          remotes: { api: { host: 'api.example.test' } },
        }),
      { message: 'Remote and service names must be distinct' },
    );
  }
});

test('resolveConfig rejects collisions with built-in services and remotes', (t) => {
  for (const name of ['dex', 'oauth2_proxy', 'nginx', 'otelcol']) {
    assert.throws(
      () =>
        resolveForTest(t, {
          telemetry: true,
          remotes: { [name]: {} },
        }),
      { message: 'Remote and service names must be distinct' },
    );
  }
  assert.throws(
    () =>
      resolveForTest(t, {
        idp: { issuer: 'https://idp.example.test' },
        services: { idp: { image: 'example/idp' } },
      }),
    { message: 'Remote and service names must be distinct' },
  );
});

test('resolveConfig preserves built-in routes when service ports are overridden', (t) => {
  const { config } = resolveForTest(t, {
    services: { dex: { upstream: { port: 5558 } } },
  });
  const dex = config.services.dex.upstream;
  assert.ok(dex);
  assert.equal(dex.host, '127.0.0.1');
  assert.equal(dex.port, 5558);
  assert.equal(dex.scheme, 'http');
  assert.equal(dex.locations['/dex/'].auth.enabled, false);
  assert.equal(dex.locations['/dex/'].csrf, false);
  assert.equal(
    dex.locations['/dex/'].headers.Cookie,
    'dex_session=$cookie_dex_session',
  );
  assert.deepEqual(dex.locations['/dex/'].directives.limit_req, [
    'zone=dex_password burst=5 nodelay',
  ]);
  assert.ok(dex.http);
  assert.match(dex.http, /limit_req_zone/);
  const proxy = config.services.oauth2_proxy.upstream;
  assert.ok(proxy);
  assert.equal(proxy.host, '127.0.0.1');
  assert.equal(proxy.port, 4180);
  assert.equal(proxy.locations['/oauth2/'].auth.enabled, false);
  assert.equal(proxy.locations['/oauth2/'].headers.Cookie, '$http_cookie');
  assert.equal(proxy.locations['= /oauth2/auth'].headers.Cookie, '$app_cookie');
  assert.deepEqual(proxy.locations['= /oauth2/auth'].directives.internal, ['']);
  assert.equal(proxy.locations['/oauth2/sign_out'].auth.enabled, true);
  assert.match(
    proxy.locations['/oauth2/sign_out'].headers['X-Auth-Request-Redirect'],
    /id_token_hint=\{id_token\}/,
  );
});

test('resolveConfig uses service upstream configuration for custom and built-in services', (t) => {
  for (const name of ['api', 'dex', 'oauth2_proxy']) {
    const { config } = resolveForTest(t, {
      services: {
        [name]: {
          upstream: {
            host: 'service.internal',
            headers: { 'X-Example': 'value' },
            port: 8080,
            locations: { '/custom/': { auth: { enabled: false } } },
          },
        },
      },
    });
    assert.ok(config.services[name].upstream);
    const upstream = config.services[name].upstream;
    assert.equal(upstream.host, 'service.internal');
    assert.equal(upstream.port, 8080);
    assert.equal(upstream.scheme, 'http');
    assert.deepEqual(Object.keys(upstream.locations), ['/custom/']);
    assert.equal(upstream.locations['/custom/'].auth.enabled, false);
    assert.equal(upstream.locations['/custom/'].headers['X-Example'], 'value');
  }
});

test('resolveConfig derives service forwarding and WebSocket settings after location overrides', (t) => {
  const { config } = resolveForTest(t, {
    services: {
      api: {
        image: 'example/api',
        upstream: {
          port: 8080,
          auth: { forward: 'access' },
          ws: true,
          headers: { 'X-Service': 'api', 'X-Layer': 'service' },
          directives: { proxy_connect_timeout: '20s' },
          locations: {
            '/api/': {
              auth: { forward: false },
              ws: false,
              headers: { 'X-Layer': 'route', 'X-Route': 'api' },
              directives: { proxy_send_timeout: '30s' },
            },
          },
        },
      },
    },
  });
  const api = config.services.api.upstream;
  assert.ok(api);
  assert.equal(api.host, 'api');
  assert.equal(api.port, 8080);
  assert.equal(api.scheme, 'http');
  const route = api.locations['/api/'];
  assert.deepEqual(route.auth, { enabled: true, forward: false });
  assert.equal(route.headers.Authorization, '""');
  assert.equal(route.headers.Connection, undefined);
  assert.equal(route.headers.Upgrade, undefined);
  assert.equal(route.headers['X-Service'], 'api');
  assert.equal(route.headers['X-Layer'], 'route');
  assert.equal(route.headers['X-Route'], 'api');
  assert.equal(route.directives.proxy_http_version, undefined);
  assert.deepEqual(route.directives.proxy_connect_timeout, ['20s']);
  assert.deepEqual(route.directives.proxy_read_timeout, ['5s']);
  assert.deepEqual(route.directives.proxy_send_timeout, ['30s']);
});

test('resolveConfig inherits upstream proxy policy and permits location overrides', (t) => {
  const { config } = resolveForTest(t, {
    remotes: {
      api: {
        auth: { forward: true },
        csrf: false,
        ws: true,
        directives: { proxy_read_timeout: '20s' },
        locations: {
          '/api/': {},
          '/public/': {
            auth: { enabled: false, forward: false },
            csrf: true,
            ws: false,
            directives: { proxy_read_timeout: '10s' },
          },
        },
      },
    },
  });

  const api = config.remotes.api.locations['/api/'];
  assert.deepEqual(api.auth, { enabled: true, forward: 'access' });
  assert.equal(api.csrf, false);
  assert.equal(api.ws, true);
  assert.equal(api.headers.Authorization, '"Bearer $access_token"');
  assert.equal(api.headers.Upgrade, '$http_upgrade');
  assert.deepEqual(api.directives.proxy_read_timeout, ['20s']);

  const publicRoute = config.remotes.api.locations['/public/'];
  assert.deepEqual(publicRoute.auth, { enabled: false, forward: false });
  assert.equal(publicRoute.csrf, true);
  assert.equal(publicRoute.ws, false);
  assert.equal(publicRoute.headers.Authorization, '""');
  assert.equal(publicRoute.headers.Upgrade, undefined);
  assert.deepEqual(publicRoute.directives.proxy_read_timeout, ['10s']);
});

test('resolveConfig gives the application root its identity and WebSocket defaults', (t) => {
  const { config } = resolveForTest(t);
  const upstream = config.app.upstream;
  const root = upstream.locations['/'];
  assert.equal(upstream.host, 'host.docker.internal');
  assert.equal(upstream.scheme, 'http');
  assert.equal(upstream.port, 6173);
  assert.deepEqual(Object.keys(upstream.locations), ['/']);
  assert.deepEqual(root.auth, { enabled: true, forward: false });
  assert.equal(root.csrf, true);
  assert.equal(root.ws, true);
  assert.equal(root.headers.Authorization, '""');
  assert.equal(root.headers.Host, '$host');
  assert.equal(root.headers['X-Auth-Request-User'], '$auth_user');
  assert.equal(root.headers['X-Auth-Request-Email'], '$auth_email');
  assert.equal(root.headers[VisageEdgeKeyHeader], '$edge_key');
  assert.equal(root.headers.Upgrade, '$http_upgrade');
  assert.equal(root.headers.Connection, '$connection_upgrade');
  assert.deepEqual(root.directives.proxy_http_version, ['1.1']);
  assert.deepEqual(root.directives.proxy_read_timeout, ['1h']);
  assert.equal(config.remotes.app, undefined);
  assert.equal(config.remotes.vite, undefined);
});

test('resolveConfig respects explicit empty service locations', (t) => {
  const { config } = resolveForTest(t, {
    services: { api: { image: 'example/api', upstream: { locations: {} } } },
  });
  assert.ok(config.services.api.upstream);
  assert.deepEqual(config.services.api.upstream.locations, {});
});

test('resolveConfig applies WebSocket proxy policy and explicit overrides', (t) => {
  const { config } = resolveForTest(t, {
    remotes: {
      api: {
        locations: {
          '/live/': { ws: true },
          '/plain/': {},
          '/disabled/': { ws: false },
          '/custom/': {
            ws: true,
            headers: {
              Connection: 'close',
              Upgrade: '$custom_upgrade',
            },
            directives: {
              proxy_http_version: '2',
              proxy_read_timeout: '30s',
            },
          },
        },
      },
    },
  });

  assert.equal(config.remotes.api.locations['/live/'].ws, true);
  assert.equal(config.remotes.api.locations['/plain/'].ws, false);
  assert.equal(config.remotes.api.locations['/disabled/'].ws, false);
  assert.equal(
    config.remotes.api.locations['/live/'].headers.Connection,
    '$connection_upgrade',
  );
  assert.equal(
    config.remotes.api.locations['/live/'].headers.Upgrade,
    '$http_upgrade',
  );
  assert.deepEqual(
    config.remotes.api.locations['/live/'].directives.proxy_http_version,
    ['1.1'],
  );
  assert.deepEqual(
    config.remotes.api.locations['/live/'].directives.proxy_read_timeout,
    ['1h'],
  );

  assert.equal(
    config.remotes.api.locations['/plain/'].headers.Connection,
    undefined,
  );
  assert.equal(
    config.remotes.api.locations['/plain/'].headers.Upgrade,
    undefined,
  );
  assert.equal(
    config.remotes.api.locations['/plain/'].directives.proxy_http_version,
    undefined,
  );
  assert.deepEqual(
    config.remotes.api.locations['/plain/'].directives.proxy_read_timeout,
    ['5s'],
  );
  assert.equal(
    config.remotes.api.locations['/disabled/'].headers.Connection,
    undefined,
  );
  assert.equal(
    config.remotes.api.locations['/disabled/'].headers.Upgrade,
    undefined,
  );
  assert.equal(
    config.remotes.api.locations['/disabled/'].directives.proxy_http_version,
    undefined,
  );
  assert.deepEqual(
    config.remotes.api.locations['/disabled/'].directives.proxy_read_timeout,
    ['5s'],
  );

  assert.equal(
    config.remotes.api.locations['/custom/'].headers.Connection,
    'close',
  );
  assert.equal(
    config.remotes.api.locations['/custom/'].headers.Upgrade,
    '$custom_upgrade',
  );
  assert.deepEqual(
    config.remotes.api.locations['/custom/'].directives.proxy_http_version,
    ['2'],
  );
  assert.deepEqual(
    config.remotes.api.locations['/custom/'].directives.proxy_read_timeout,
    ['30s'],
  );
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
    redirectUri: 'https://localhost:9001/oauth2/callback',
    postLogoutRedirectUri: 'https://localhost:9001/oauth2/start?rd=/',
  });
});

test('resolveConfig supports external IdP upstreams', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      issuer: 'http://idp.localhost:5557/idp',
    },
  });

  assert.equal(config.services.dex, undefined);
  assert.equal(config.services.nginx.depends_on, undefined);
  assert.deepEqual(config.services.nginx.extra_hosts, [
    'host.docker.internal:host-gateway',
  ]);
  assert.equal(config.services.oauth2_proxy.depends_on, undefined);
  assert.equal(config.services.oauth2_proxy.extra_hosts, undefined);
  assert.equal(config.services.oauth2_proxy.network_mode, 'service:nginx');
  assert.equal(config.services.dex, undefined);
  assert.equal(config.remotes.idp.host, 'idp.localhost');
  assert.equal(config.remotes.idp.scheme, 'http');
  assert.equal(config.remotes.idp.port, 5557);
  assert.deepEqual(config.remotes.idp.locations, {});
  assert.equal(config.idp.oidc.issuer, 'http://idp.localhost:5557/idp');
  assert.equal(config.idp.oidc.algs, undefined);
  assert.equal(config.idp.oidc.end_session_endpoint, undefined);
});

test('resolveConfig supports external IdP end-session endpoints', (t) => {
  const { config } = resolveForTest(t, {
    idp: {
      issuer: 'http://idp.localhost:5557/idp',
      end_session_endpoint: 'http://idp.localhost:5557/idp/logout',
      algs: ['RS512'],
    },
  });

  assert.deepEqual(config.idp.oidc.algs, ['RS512']);
  assert.equal(
    config.idp.oidc.end_session_endpoint,
    'http://idp.localhost:5557/idp/logout',
  );
  assert.ok(config.services.oauth2_proxy.upstream);
  assert.equal(
    config.services.oauth2_proxy.upstream.locations['/oauth2/sign_out'].headers[
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

  assert.equal(config.remotes.idp.scheme, 'https');
  assert.equal(config.remotes.idp.port, 443);
  assert.deepEqual(config.remotes.idp.locations, {});
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

  assert.equal(config.remotes.idp.host, 'idp.example.test');
  assert.equal(config.remotes.idp.scheme, 'https');
  assert.equal(config.remotes.idp.port, 443);
  assert.deepEqual(config.remotes.idp.locations, {});
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
    telemetry: {},
    idp: {
      issuer: 'http://idp.localhost:5557/idp',
    },
    services: {
      nginx: {
        environment: {
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4317',
        },
        extra_hosts: ['idp.localhost:host-gateway'],
      },
    },
  });

  assert.deepEqual(config.services.nginx.extra_hosts, [
    'host.docker.internal:host-gateway',
    'idp.localhost:host-gateway',
  ]);
  assert.deepEqual(config.services.nginx.environment, {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4317',
  });
  assert.equal(config.package, 'test-app');
  assert.equal(
    config.services.nginx.image,
    'ghcr.io/blakearoberts/visage-nginx:next',
  );
  assert.deepEqual(config.nginx.mount, ['./nginx', '/etc/nginx']);
  assert.deepEqual(config.nginx.modules, [
    '/usr/lib/nginx/modules/ngx_http_js_module.so',
    '/usr/lib/nginx/modules/ngx_otel_module.so',
  ]);
  assert.deepEqual(config.services.oauth2_proxy.command, [
    '--config',
    '/etc/oauth2-proxy/config.yml',
  ]);
  assert.equal(config.services.oauth2_proxy.depends_on, undefined);
  assert.equal(config.services.oauth2_proxy.extra_hosts, undefined);
  assert.equal(config.services.oauth2_proxy.network_mode, 'service:nginx');
  assert.equal(config.services.otelcol.network_mode, undefined);
  assert.equal(config.services.otelcol.depends_on, undefined);
  assert.equal(config.telemetry, true);
});

test('resolveConfig applies defaults and normalizes upstream locations', (t) => {
  const { cache, config } = resolveForTest(t, {
    remotes: {
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

  assert.equal(config.app.host, 'app.local.test');
  assert.equal(config.app.port, 9443);
  assert.equal(config.cache, cache);
  assert.equal(
    config.idp.oidc.end_session_endpoint,
    'https://app.local.test:9443/dex/logout',
  );
  assert.equal(config.app.upstream.scheme, 'http');
  assert.ok(config.services.dex.upstream);
  assert.equal(config.services.dex.upstream.port, 5556);
  assert.equal(config.services.dex.upstream.scheme, 'http');
  assert.ok(config.services.oauth2_proxy.upstream);
  assert.equal(config.services.oauth2_proxy.upstream.host, '127.0.0.1');
  assert.equal(config.services.oauth2_proxy.upstream.port, 4180);
  assert.equal(config.services.oauth2_proxy.upstream.scheme, 'http');
  assert.deepEqual(config.remotes.api.locations['/api/'].auth, {
    enabled: true,
    forward: 'access',
  });
  assert.equal(config.remotes.api.locations['/api/'].csrf, true);
  assert.deepEqual(config.remotes.api.locations['/api/'].headers, {
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
  assert.deepEqual(config.remotes.api.locations['/api/'].directives, {
    proxy_buffer_size: ['16k'],
    proxy_connect_timeout: ['5s'],
    proxy_read_timeout: ['5s'],
    proxy_send_timeout: ['5s'],
    proxy_hide_header: ['X-A', 'X-B'],
  });
  assert.equal(config.remotes.metrics.host, 'metrics');
  assert.deepEqual(config.remotes.metrics.locations['/metrics/'].auth, {
    enabled: true,
    forward: false,
  });
  assert.equal(config.remotes.metrics.locations['/metrics/'].csrf, true);
  assert.deepEqual(config.remotes.metrics.locations['/metrics/'].directives, {
    proxy_buffer_size: ['8k'],
    proxy_connect_timeout: ['5s'],
    proxy_read_timeout: ['5s'],
    proxy_send_timeout: ['5s'],
  });
  assert.equal(
    config.remotes.metrics.locations['/metrics/'].headers?.Host,
    'metrics',
  );
  assert.equal(config.remotes.metrics.scheme, 'https');
  assert.equal(config.remotes.metrics.port, 443);
  assert.equal(
    config.app.upstream.locations['/'].headers?.['X-Auth-Request-User'],
    '$auth_user',
  );
  assert.equal(
    config.app.upstream.locations['/'].headers?.['X-Auth-Request-Email'],
    '$auth_email',
  );
});

test('resolveConfig resolves scoped package names', (t) => {
  const root = tempCache(t);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@blakearoberts/visage' }),
    'utf8',
  );

  const config = resolveConfig({
    ...resolveOptions({}),
    cache: join(root, '.visage'),
    root,
    edgeKey: 'edge-key',
    appPort: 6173,
  });

  assert.equal(config.package, '@blakearoberts/visage');
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
    remotes: {
      external: {
        locations: { '/external/': { auth: { forward: true } } },
      },
    },
  });
  assert.ok(config.services.api.upstream);
  assert.equal(
    config.services.api.upstream.locations['/api/'].auth.forward,
    'id',
  );
  assert.equal(
    config.remotes.external.locations['/external/'].auth.forward,
    'access',
  );
  assert.equal(config.app.upstream.locations['/'].auth.forward, false);
});

test('a remote named vite is independent of the application', (t) => {
  const { config } = resolveForTest(t, {
    remotes: { vite: { host: 'other.example.test', auth: { forward: true } } },
  });
  assert.equal(config.app.upstream.host, 'host.docker.internal');
  assert.equal(config.app.upstream.port, 6173);
  assert.equal(config.remotes.vite.host, 'other.example.test');
  assert.equal(config.remotes.vite.scheme, 'https');
  assert.equal(config.remotes.vite.locations['/vite/'].auth.forward, 'access');
});

test('resolveConfig applies CSRF defaults and overrides', (t) => {
  const { config } = resolveForTest(t, {
    remotes: {
      api: {
        locations: {
          '/api/': {},
          '/browser/': { csrf: true },
          '/webhook/': { auth: { enabled: false } },
          '/custom/': { csrf: false },
        },
      },
    },
  });

  assert.equal(config.app.upstream.locations['/'].csrf, true);
  assert.equal(config.remotes.api.locations['/api/'].csrf, true);
  assert.equal(config.remotes.api.locations['/browser/'].csrf, true);
  assert.equal(config.remotes.api.locations['/webhook/'].csrf, false);
  assert.equal(config.remotes.api.locations['/custom/'].csrf, false);
  assert.ok(config.services.dex.upstream);
  assert.equal(config.services.dex.upstream.locations['/dex/'].csrf, false);
  assert.ok(config.services.oauth2_proxy.upstream);
  assert.equal(
    config.services.oauth2_proxy.upstream.locations['/oauth2/'].csrf,
    false,
  );
});

test('resolveConfig lets services and remotes override their own defaults', (t) => {
  const { config } = resolveForTest(t, {
    services: {
      nginx: {
        image: 'custom-nginx:test',
        depends_on: ['api'],
        environment: {
          OTEL_SERVICE_NAME: 'custom-nginx',
          OTEL_SERVICE_NAMESPACE: 'custom-namespace',
        },
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
    remotes: {
      external: {
        host: 'external',
        port: 3000,
        locations: {
          '/app/': {
            auth: { forward: 'access' },
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
    environment: {
      OTEL_SERVICE_NAME: 'custom-nginx',
      OTEL_SERVICE_NAMESPACE: 'custom-namespace',
    },
    extra_hosts: ['host.docker.internal:host-gateway'],
    restart: 'always',
  });
  const { upstream: apiUpstream, ...apiService } = config.services.api;
  assert.ok(apiUpstream);
  assert.deepEqual(apiService, {
    image: 'example/api:test',
    command: ['serve'],
    restart: 'on-failure',
  });
  assert.equal(apiUpstream.host, 'backend');
  assert.deepEqual(Object.keys(apiUpstream.locations), ['/api/']);
  assert.equal(apiUpstream.locations['/api/'].headers?.Host, '$host');

  assert.equal(config.remotes.external.host, 'external');
  assert.equal(config.remotes.external.port, 3000);
  assert.deepEqual(config.remotes.external.locations['/app/'].auth, {
    enabled: true,
    forward: 'access',
  });
  assert.equal(
    config.remotes.external.locations['/app/'].headers?.Cookie,
    '""',
  );
  assert.equal(
    config.remotes.external.locations['/app/'].headers?.Host,
    'external',
  );
  assert.equal(
    config.remotes.external.locations['/app/'].headers?.Upgrade,
    '$http_upgrade',
  );
});

test('Dex upstream overrides preserve its built-in defaults', (t) => {
  const { config } = resolveForTest(t, {
    services: { dex: { upstream: { ws: true } } },
  });
  const dex = config.services.dex.upstream;
  assert.ok(dex);
  const login = dex.locations['/dex/'];
  assert.equal(dex.host, '127.0.0.1');
  assert.equal(dex.port, 5556);
  assert.equal(dex.scheme, 'http');
  assert.equal(login.ws, true);
  assert.deepEqual(login.auth, { enabled: false, forward: false });
  assert.equal(login.csrf, false);
  assert.equal(login.headers.Cookie, 'dex_session=$cookie_dex_session');
  assert.deepEqual(login.directives.limit_req, [
    'zone=dex_password burst=5 nodelay',
  ]);
  assert.ok(dex.http);
  assert.match(dex.http, /~\^POST:\/dex\/auth\//);
});

test('Dex public hosts retain paths and isolate the application session', (t) => {
  const { config } = resolveForTest(t, {
    services: { dex: { host: 'idp.local.test' } },
  });
  assert.deepEqual(config.hosts, ['app.local.test', 'idp.local.test']);
  assert.equal(config.idp.oidc.issuer, 'https://idp.local.test:9443/dex');
  assert.equal(
    config.idp.oidc.authorization,
    'https://idp.local.test:9443/dex/auth',
  );
  assert.equal(
    config.idp.oidc.end_session_endpoint,
    'https://idp.local.test:9443/dex/logout',
  );
  assert.equal(config.idp.oidc.token, 'http://127.0.0.1:5556/dex/token');
  assert.equal(config.idp.oidc.jwks, 'http://127.0.0.1:5556/dex/keys');
  assert.equal(
    config.app.client.redirectUri,
    'https://app.local.test:9443/oauth2/callback',
  );
  assert.equal(config.app.cookie.cookie_name, '__Host-sess');
  assert.equal(config.app.cookie.cookie_domains, undefined);
  assert.ok(config.services.dex.upstream);
  assert.deepEqual(Object.keys(config.services.dex.upstream.locations), [
    '/dex/',
  ]);
  assert.equal(
    config.services.dex.upstream.locations['/dex/'].auth.enabled,
    false,
  );
});

test('service hosts preserve backend addresses, paths, and independent authentication', (t) => {
  const { config } = resolveForTest(t, {
    services: {
      api: { host: 'api.dev.test', upstream: { host: 'backend.internal' } },
      worker: { host: 'worker.dev.test', upstream: false },
      custom: {
        host: 'custom.dev.test',
        upstream: { locations: { '/custom/': { auth: { enabled: false } } } },
      },
    },
    remotes: {
      remote: { host: 'remote.internal', locations: { '/remote/': {} } },
    },
  });
  assert.deepEqual(config.hosts, [
    'app.local.test',
    'api.dev.test',
    'worker.dev.test',
    'custom.dev.test',
  ]);
  assert.equal(config.services.worker.host, 'worker.dev.test');
  assert.equal(config.services.worker.upstream, undefined);
  assert.ok(config.services.api.upstream);
  assert.equal(
    config.services.api.upstream.locations['/api/'].auth.enabled,
    true,
  );
  assert.equal(config.services.api.upstream.locations['/api/'].csrf, true);
  assert.equal(config.services.api.upstream.host, 'backend.internal');
  assert.ok(config.services.custom.upstream);
  assert.equal(
    config.services.custom.upstream.locations['/custom/'].auth.enabled,
    false,
  );
  assert.deepEqual(Object.keys(config.services.custom.upstream.locations), [
    '/custom/',
  ]);
  assert.equal(config.remotes.remote.host, 'remote.internal');
  assert.equal(config.remotes.remote.locations['/remote/'].auth.enabled, true);
});
