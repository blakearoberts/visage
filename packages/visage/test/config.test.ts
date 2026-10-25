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
        upstreams: {
          vite: { port: 6173 },
          ...options.upstreams,
        },
      }),
      cache,
      root: 'test-app',
      edgeKey: 'edge-key',
    }),
  };
}

test('resolveOptions applies public defaults', () => {
  const options = resolveOptions({});

  assert.equal(options.host, 'localhost');
  assert.equal(options.port, 9001);
  assert.equal(options.telemetry, false);
  assert.equal(options.services.otelcol, undefined);
  assert.equal(options.upstreams.otelcol, undefined);
  assert.deepEqual(options.cookie, {
    cookie_name: '__Host-sess',
    cookie_expire: '720h',
    cookie_refresh: '30s',
    cookie_path: '/',
  });
  assert.deepEqual(options.idp, {
    dex: {
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
    },
  });
  assert.deepEqual(options.oauth2, {
    id: 'visage',
    secret: 'visage-secret',
    scopes: ['openid', 'offline_access'],
    public: false,
    postLogoutRedirectUri: 'https://localhost:9001/oauth2/start?rd=/',
  });
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
  assert.deepEqual(config.services.nginx.environment, {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otelcol:4317',
    OTEL_SERVICE_NAME: 'nginx',
  });
  assert.equal(config.upstreams.otelcol.host, 'otelcol');
  assert.equal(config.upstreams.otelcol.port, 4318);
  assert.deepEqual(config.upstreams.otelcol.locations['/t/'].auth, {
    enabled: true,
    forward: false,
  });
  assert.deepEqual(config.upstreams.otelcol.locations['/t/'].directives, {
    proxy_buffer_size: ['8k'],
    proxy_connect_timeout: ['5s'],
    proxy_read_timeout: ['5s'],
    proxy_send_timeout: ['5s'],
    rewrite: ['^/t/(.*)$ /$1 break'],
  });
});

test('resolveConfig resolves the complete Vite loopback service', (t) => {
  for (const [vite, port] of [
    [{}, 80],
    [{ scheme: 'https' }, 443],
    [{ port: 6173 }, 6173],
    [{ scheme: 'https', port: 6174 }, 6174],
  ] as const) {
    const { config } = resolveForTest(t, { upstreams: { vite } });
    assert.equal(
      config.services.vite_loopback.command,
      `tcp-listen:${port},fork,bind=host.docker.internal ` +
        `tcp-connect:127.0.0.1:${port}`,
    );
    assert.equal(config.upstreams.vite.port, port);
    assert.deepEqual(config.services.vite_loopback.profiles, ['linux']);
    assert.equal(config.services.vite_loopback.restart, 'always');
  }

  const service = { image: 'custom/socat', command: ['custom'], profiles: [] };
  const { config } = resolveForTest(t, {
    upstreams: { vite: { port: 6173 } },
    services: { vite_loopback: service },
  });
  assert.equal(config.services.vite_loopback.image, service.image);
  assert.deepEqual(config.services.vite_loopback.command, service.command);
  assert.deepEqual(config.services.vite_loopback.profiles, service.profiles);
  for (const services of [undefined, { vite_loopback: service }]) {
    const standalone = resolveConfig({
      ...resolveOptions({ services }),
      root: 'test-app',
      cache: tempCache(t),
      edgeKey: 'edge-key',
    });
    assert.deepEqual(
      standalone.services.vite_loopback,
      services ? { restart: 'on-failure', ...service } : undefined,
    );
  }
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

  assert.deepEqual(options.idp, {
    dex: {
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

  assert.deepEqual(options.idp, {
    issuer: 'http://idp.localhost:5557/idp',
    algs: ['RS512'],
  });
});

test('resolveConfig applies upstream defaults', (t) => {
  const { config } = resolveForTest(t, {
    upstreams: {
      api: {},
      secure: {
        scheme: 'https',
      },
    },
  });

  assert.equal(config.upstreams.api.host, 'api');
  assert.equal(config.upstreams.api.scheme, 'https');
  assert.equal(config.upstreams.api.port, 443);
  assert.equal(config.upstreams.secure.host, 'secure');
  assert.equal(config.upstreams.secure.scheme, 'https');
  assert.equal(config.upstreams.secure.port, 443);
});

test('resolveConfig applies upstream headers to every location', (t) => {
  const { config } = resolveForTest(t, {
    upstreams: {
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
    config.upstreams.api.locations['/api/'].headers.Host,
    'api.internal',
  );
  assert.equal(
    config.upstreams.api.locations['/api/'].headers['X-Service'],
    'api',
  );
  assert.equal(
    config.upstreams.api.locations['/api/'].headers['X-Scope'],
    'upstream',
  );
  assert.equal(
    config.upstreams.api.locations['/admin/'].headers['X-Service'],
    'api',
  );
  assert.equal(
    config.upstreams.api.locations['/admin/'].headers['X-Scope'],
    'admin',
  );
});

test('resolveConfig derives upstreams from services', (t) => {
  const { config } = resolveForTest(t, {
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

  assert.deepEqual(config.services.api, {
    image: 'example/api:test',
    restart: 'on-failure',
  });
  assert.equal(config.upstreams.api.host, 'api.local.test');
  assert.equal(config.upstreams.api.scheme, 'http');
  assert.equal(config.upstreams.api.port, 9000);
  assert.equal(config.upstreams.whoami.host, 'whoami');
  assert.equal(config.upstreams.whoami.scheme, 'http');
  assert.equal(config.upstreams.whoami.port, 80);
  assert.equal(config.upstreams.secure.host, 'secure');
  assert.equal(config.upstreams.secure.scheme, 'https');
  assert.equal(config.upstreams.secure.port, 443);
  assert.equal(config.upstreams.external.host, 'external');
  assert.equal(config.upstreams.external.scheme, 'https');
  assert.equal(config.upstreams.external.port, 443);
  assert.equal(config.upstreams.externalHttp.host, 'externalHttp');
  assert.equal(config.upstreams.externalHttp.scheme, 'http');
  assert.equal(config.upstreams.externalHttp.port, 80);
});

test('resolveConfig applies Vite upstream defaults and merges the root location', (t) => {
  const { config } = resolveForTest(t, {
    upstreams: {
      vite: {
        port: 6173,
        headers: {
          Host: 'vite.internal',
          'X-Shared': 'vite',
        },
        locations: {
          '/': {
            auth: { forward: true },
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
    },
  });

  assert.equal(config.upstreams.vite.host, 'host.docker.internal');
  assert.equal(config.upstreams.vite.scheme, 'http');
  assert.equal(config.upstreams.vite.port, 6173);
  assert.deepEqual(config.upstreams.vite.locations['/'].auth, {
    enabled: true,
    forward: 'id',
  });
  assert.equal(config.upstreams.vite.locations['/'].csrf, true);
  assert.equal(config.upstreams.vite.locations['/'].headers.Host, '$host');
  assert.equal(
    config.upstreams.vite.locations['/'].headers.Upgrade,
    '$http_upgrade',
  );
  assert.equal(
    config.upstreams.vite.locations['/'].headers.Connection,
    '$connection_upgrade',
  );
  assert.deepEqual(
    config.upstreams.vite.locations['/'].directives.proxy_http_version,
    ['1.1'],
  );
  assert.deepEqual(
    config.upstreams.vite.locations['/'].directives.proxy_read_timeout,
    ['1h'],
  );
  assert.equal(
    config.upstreams.vite.locations['/'].headers['X-Shared'],
    'vite',
  );
  assert.equal(config.upstreams.vite.locations['/'].headers['X-App'], 'root');
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers['X-Shared'],
    'vite',
  );
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers['X-App'],
    'nested',
  );
});

test('resolveConfig applies WebSocket proxy policy and explicit overrides', (t) => {
  const { config } = resolveForTest(t, {
    upstreams: {
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

  assert.equal(
    config.upstreams.api.locations['/live/'].headers.Connection,
    '$connection_upgrade',
  );
  assert.equal(
    config.upstreams.api.locations['/live/'].headers.Upgrade,
    '$http_upgrade',
  );
  assert.deepEqual(
    config.upstreams.api.locations['/live/'].directives.proxy_http_version,
    ['1.1'],
  );
  assert.deepEqual(
    config.upstreams.api.locations['/live/'].directives.proxy_read_timeout,
    ['1h'],
  );

  assert.equal(
    config.upstreams.api.locations['/plain/'].headers.Connection,
    undefined,
  );
  assert.equal(
    config.upstreams.api.locations['/plain/'].headers.Upgrade,
    undefined,
  );
  assert.equal(
    config.upstreams.api.locations['/plain/'].directives.proxy_http_version,
    undefined,
  );
  assert.deepEqual(
    config.upstreams.api.locations['/plain/'].directives.proxy_read_timeout,
    ['5s'],
  );
  assert.equal(
    config.upstreams.api.locations['/disabled/'].headers.Connection,
    undefined,
  );
  assert.equal(
    config.upstreams.api.locations['/disabled/'].headers.Upgrade,
    undefined,
  );
  assert.equal(
    config.upstreams.api.locations['/disabled/'].directives.proxy_http_version,
    undefined,
  );
  assert.deepEqual(
    config.upstreams.api.locations['/disabled/'].directives.proxy_read_timeout,
    ['5s'],
  );

  assert.equal(
    config.upstreams.api.locations['/custom/'].headers.Connection,
    'close',
  );
  assert.equal(
    config.upstreams.api.locations['/custom/'].headers.Upgrade,
    '$custom_upgrade',
  );
  assert.deepEqual(
    config.upstreams.api.locations['/custom/'].directives.proxy_http_version,
    ['2'],
  );
  assert.deepEqual(
    config.upstreams.api.locations['/custom/'].directives.proxy_read_timeout,
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
    OTEL_SERVICE_NAME: 'nginx',
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
  assert.equal(
    config.idp.oidc.end_session_endpoint,
    'https://app.local.test:9443/dex/logout',
  );
  assert.equal(config.upstreams.vite.scheme, 'http');
  assert.equal(config.upstreams.dex.port, 5556);
  assert.equal(config.upstreams.dex.scheme, 'http');
  assert.equal(config.upstreams.oauth2_proxy.host, '127.0.0.1');
  assert.equal(config.upstreams.oauth2_proxy.port, 4180);
  assert.equal(config.upstreams.oauth2_proxy.scheme, 'http');
  assert.deepEqual(config.upstreams.api.locations['/api/'].auth, {
    enabled: true,
    forward: 'access',
  });
  assert.equal(config.upstreams.api.locations['/api/'].csrf, true);
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
    proxy_connect_timeout: ['5s'],
    proxy_read_timeout: ['5s'],
    proxy_send_timeout: ['5s'],
    proxy_hide_header: ['X-A', 'X-B'],
  });
  assert.equal(config.upstreams.metrics.host, 'metrics');
  assert.deepEqual(config.upstreams.metrics.locations['/metrics/'].auth, {
    enabled: true,
    forward: false,
  });
  assert.equal(config.upstreams.metrics.locations['/metrics/'].csrf, true);
  assert.deepEqual(config.upstreams.metrics.locations['/metrics/'].directives, {
    proxy_buffer_size: ['8k'],
    proxy_connect_timeout: ['5s'],
    proxy_read_timeout: ['5s'],
    proxy_send_timeout: ['5s'],
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
  });

  assert.equal(config.package, '@blakearoberts/visage');
});

test('resolveConfig adds the managed edge key to the Vite root location and preserves other headers', (t) => {
  const cache = tempCache(t);
  const config = resolveConfig({
    ...resolveOptions({
      upstreams: {
        vite: {
          port: 6173,
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
      },
    }),
    cache,
    root: 'edge-test',
    edgeKey: 'edge-key',
  });

  assert.equal(config.edgeKey, 'edge-key');
  assert.equal(config.secrets.edgeKey, 'VISAGE_EDGE_KEY');
  assert.equal(
    config.upstreams.vite.locations['/'].headers[VisageEdgeKeyHeader],
    '$edge_key',
  );
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers[VisageEdgeKeyHeader],
    undefined,
  );
  assert.equal(config.upstreams.vite.locations['/'].headers['X-App'], 'root');
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers['X-App'],
    'nested',
  );
});

test('resolveConfig gives the managed edge key precedence in the Vite root location', (t) => {
  const cache = tempCache(t);
  const config = resolveConfig({
    ...resolveOptions({
      upstreams: {
        vite: {
          port: 6173,
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
      },
    }),
    cache,
    root: 'edge-test',
    edgeKey: 'edge-key',
  });

  assert.equal(
    config.upstreams.vite.locations['/'].headers[VisageEdgeKeyHeader],
    '$edge_key',
  );
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers[VisageEdgeKeyHeader],
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
        port: 6173,
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

test('resolveConfig treats the resolved Vite upstream as first-party for token forwarding', (t) => {
  const { config } = resolveForTest(t, {
    upstreams: {
      vite: {
        port: 6173,
        locations: { '/': { auth: { forward: true } } },
      },
    },
  });

  assert.equal(config.upstreams.vite.host, 'host.docker.internal');
  assert.equal(config.upstreams.vite.external, true);
  assert.equal(config.upstreams.vite.locations['/'].auth.forward, 'id');
  assert.equal(
    config.upstreams.vite.locations['/'].headers.Authorization,
    '$authorization',
  );
});

test('resolveConfig applies CSRF defaults and overrides', (t) => {
  const { config } = resolveForTest(t, {
    upstreams: {
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

  assert.equal(config.upstreams.vite.locations['/'].csrf, true);
  assert.equal(config.upstreams.api.locations['/api/'].csrf, true);
  assert.equal(config.upstreams.api.locations['/browser/'].csrf, true);
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
    upstreams: {
      vite: {
        host: 'vite',
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
  assert.deepEqual(config.upstreams.vite.locations['/app/'].auth, {
    enabled: true,
    forward: 'access',
  });
  assert.equal(config.upstreams.vite.locations['/app/'].headers?.Cookie, '""');
  assert.equal(config.upstreams.vite.locations['/app/'].headers?.Host, 'vite');
  assert.equal(
    config.upstreams.vite.locations['/app/'].headers?.Upgrade,
    '$http_upgrade',
  );
});
