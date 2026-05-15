import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { compareSync } from 'bcryptjs';
import { parse } from 'yaml';

import {
  resolveConfig,
  resolveOptions,
  resolveViteUpstream,
  type VisageConfig,
} from '../../src/config.ts';
import { writeComposeConfig } from '../../src/render/compose.ts';
import { writeDexConfig } from '../../src/render/dex.ts';
import { writeNginxConfig } from '../../src/render/nginx.ts';
import { writeOauth2ProxyConfig } from '../../src/render/oauth2-proxy.ts';
import type { VisageOptions } from '../../src/types.ts';

function resolvedConfig(
  t: TestContext,
  options: VisageOptions = {},
): VisageConfig {
  const cache = mkdtempSync(join(tmpdir(), 'visage-render-test-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));

  const config = resolveConfig(
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
  );
  mkdirSync(config.cache, { recursive: true });
  return config;
}

function readGenerated(config: VisageConfig, file: string) {
  return readFileSync(join(config.cache, file), 'utf8');
}

function locationBlock(rendered: string, path: string) {
  const marker = `location ${path} {`;
  const start = rendered.indexOf(marker);
  assert.notEqual(start, -1, `expected nginx location for ${path}`);

  const remaining = rendered.slice(start);
  const end = remaining.indexOf('\n        }');
  assert.notEqual(end, -1, `expected nginx location close for ${path}`);
  return remaining.slice(0, end);
}

function upstreamBlock(rendered: string, name: string) {
  const marker = `upstream ${name} {`;
  const start = rendered.indexOf(marker);
  assert.notEqual(start, -1, `expected nginx upstream for ${name}`);

  const remaining = rendered.slice(start);
  const end = remaining.indexOf('\n    }');
  assert.notEqual(end, -1, `expected nginx upstream close for ${name}`);
  return remaining.slice(0, end);
}

function locationCount(rendered: string, path: string) {
  const pattern = new RegExp(`^\\s*location ${path} \\{`, 'gm');
  return rendered.match(pattern)?.length ?? 0;
}

function parseKeyValueConfig(contents: string) {
  return Object.fromEntries(
    contents
      .trim()
      .split('\n')
      .map((line: string) => {
        const separator = line.indexOf(' = ');
        assert.notEqual(separator, -1, `expected key/value line: ${line}`);

        const key = line.slice(0, separator);
        const value = line.slice(separator + 3);
        if (value.startsWith('"') || value.startsWith('[')) {
          return [key, JSON.parse(value)];
        }
        if (value === 'true') return [key, true];
        if (value === 'false') return [key, false];
        return [key, value];
      }),
  );
}

test('writeComposeConfig renders base services and custom services', (t) => {
  const config = resolvedConfig(t, {
    services: {
      api: {
        image: 'example/api:test',
        command: ['serve'],
        depends_on: ['nginx'],
        upstream: {
          locations: { '/api/': {} },
        },
      },
    },
  });

  writeComposeConfig(config);

  const compose = parse(readGenerated(config, config.files.compose));
  assert.deepEqual(compose.services.dex.command, [
    'dex',
    'serve',
    '/etc/dex/dex.yml',
  ]);
  assert.equal(compose.services.dex.restart, 'always');
  assert.deepEqual(compose.services.dex.volumes, [
    './dex.yml:/etc/dex/dex.yml:ro',
  ]);
  assert.equal(compose.services.nginx.restart, 'always');
  assert.deepEqual(compose.services.nginx.ports, ['9443:9443']);
  assert.deepEqual(compose.services.nginx.extra_hosts, [
    'host.docker.internal:host-gateway',
  ]);
  assert.deepEqual(compose.services.nginx.volumes, [
    './certs:/etc/nginx/certs:ro',
    './nginx.conf:/etc/nginx/nginx.conf:ro',
  ]);
  assert.deepEqual(compose.services.oauth2_proxy.extra_hosts, [
    'host.docker.internal:host-gateway',
  ]);
  assert.equal(compose.services.oauth2_proxy.restart, 'always');
  assert.deepEqual(compose.services.oauth2_proxy.volumes, [
    './oauth2-proxy.yml:/etc/oauth2-proxy/config.yml:ro',
  ]);
  assert.deepEqual(compose.services.api, {
    image: 'example/api:test',
    command: ['serve'],
    depends_on: ['nginx'],
    restart: 'on-failure',
  });
});

test('writeComposeConfig mounts empty OAuth2 client secret file for public clients', (t) => {
  const config = resolvedConfig(t, {
    oauth2: { clientSecret: null },
  });

  writeComposeConfig(config);

  const compose = parse(readGenerated(config, config.files.compose));
  assert.deepEqual(compose.services.oauth2_proxy.volumes, [
    './oauth2-proxy.yml:/etc/oauth2-proxy/config.yml:ro',
    './oauth2-client-secret:/etc/oauth2-proxy/client-secret:ro',
  ]);
});

test('writeComposeConfig omits managed Dex service for external IdPs', (t) => {
  const config = resolvedConfig(t, {
    idp: {
      issuer: 'http://idp.localhost:5557/idp',
    },
  });

  writeComposeConfig(config);

  const compose = parse(readGenerated(config, config.files.compose));
  assert.equal(compose.services.dex, undefined);
  assert.deepEqual(compose.services.nginx.depends_on, ['oauth2_proxy']);
  assert.deepEqual(compose.services.nginx.extra_hosts, [
    'host.docker.internal:host-gateway',
  ]);
  assert.equal(compose.services.oauth2_proxy.depends_on, undefined);
  assert.deepEqual(compose.services.oauth2_proxy.extra_hosts, [
    'host.docker.internal:host-gateway',
  ]);
});

test('writeNginxConfig renders upstreams, auth, redirects, and headers', (t) => {
  const config = resolvedConfig(t, {
    upstreams: {
      api: {
        port: 8080,
        locations: {
          '/api/': {
            auth: { redirect: true },
            headers: {
              'X-Service': 'api',
            },
            directives: {
              proxy_buffer_size: '16k',
              proxy_hide_header: ['X-A', 'X-B'],
            },
          },
          '/public/': {
            auth: { enabled: false },
            headers: {
              Host: 'public.internal',
            },
          },
        },
      },
    },
  });

  writeNginxConfig(config);

  const nginx = readGenerated(config, config.files.nginx[0]);
  assert.match(nginx, /events \{\}/);
  assert.match(nginx, /listen 9443 ssl;/);
  assert.match(nginx, /server_name app\.local\.test;/);
  assert.match(nginx, /ssl_certificate\s+\/etc\/nginx\/certs\/tls\.crt;/);
  assert.match(
    nginx,
    /error_page 497 =301 https:\/\/\$http_host\$request_uri;/,
  );
  assert.match(nginx, /resolver 127\.0\.0\.11 ipv6=off;/);
  assert.match(
    upstreamBlock(nginx, 'api'),
    /zone api 64k;\s+server api:8080 resolve;/,
  );

  const api = locationBlock(nginx, '/api/');
  assert.match(api, /auth_request\s+\/oauth2\/auth;/);
  assert.match(
    api,
    /auth_request_set\s+\$authorization \$upstream_http_authorization;/,
  );
  assert.match(
    api,
    /error_page 401 =302 \/oauth2\/start\?rd=\$scheme:\/\/\$http_host\$request_uri;/,
  );
  assert.match(api, /proxy_set_header Cookie "";/);
  assert.match(api, /proxy_set_header Host api;/);
  assert.match(api, /proxy_set_header X-Service api;/);
  assert.match(api, /proxy_buffer_size 16k;/);
  assert.doesNotMatch(api, /proxy_buffer_size 8k;/);
  assert.match(api, /proxy_hide_header X-A;/);
  assert.match(api, /proxy_hide_header X-B;/);
  assert.match(api, /proxy_set_header Authorization \$authorization;/);
  assert.match(api, /proxy_ssl_server_name on;/);
  assert.match(api, /proxy_ssl_name api;/);
  assert.match(api, /proxy_pass https:\/\/api;/);

  const publicLocation = locationBlock(nginx, '/public/');
  assert.doesNotMatch(publicLocation, /auth_request/);
  assert.doesNotMatch(publicLocation, /Authorization/);
  assert.match(publicLocation, /proxy_set_header Host public\.internal;/);
  assert.match(publicLocation, /proxy_buffer_size 8k;/);
});

test('writeNginxConfig keeps Dex and OAuth2 Proxy endpoints public', (t) => {
  const config = resolvedConfig(t);

  writeNginxConfig(config);

  const nginx = readGenerated(config, config.files.nginx[0]);
  const dex = locationBlock(nginx, '/dex/');
  const oauth2Proxy = locationBlock(nginx, '/oauth2/');

  assert.doesNotMatch(dex, /auth_request/);
  assert.doesNotMatch(dex, /Authorization/);
  assert.doesNotMatch(oauth2Proxy, /auth_request/);
  assert.doesNotMatch(oauth2Proxy, /Authorization/);
  assert.match(oauth2Proxy, /proxy_set_header Cookie \$http_cookie;/);
  assert.match(oauth2Proxy, /proxy_buffer_size 8k;/);
});

test('writeNginxConfig preserves browser host for the built-in Vite upstream', (t) => {
  const config = resolvedConfig(t);

  writeNginxConfig(config);

  const nginx = readGenerated(config, config.files.nginx[0]);
  const root = locationBlock(nginx, '/');
  const vite = upstreamBlock(nginx, 'vite');

  assert.match(root, /proxy_set_header Host \$host;/);
  assert.doesNotMatch(root, /proxy_set_header Host host\.docker\.internal;/);
  assert.doesNotMatch(root, /proxy_set_header Authorization/);
  assert.match(root, /proxy_http_version 1\.1;/);
  assert.match(root, /proxy_read_timeout 1h;/);
  if (process.platform === 'linux') {
    assert.match(vite, /server host\.docker\.internal:6173;/);
    assert.doesNotMatch(vite, /resolve/);
  } else {
    assert.match(
      vite,
      /zone vite 64k;\s+server host\.docker\.internal:6173 resolve;/,
    );
  }
});

test('writeNginxConfig renders HTTPS upstreams with SNI', (t) => {
  const config = resolvedConfig(t, {
    upstreams: {
      api: {
        host: 'api.example.test',
        scheme: 'https',
      },
    },
  });

  writeNginxConfig(config);

  const nginx = readGenerated(config, config.files.nginx[0]);
  assert.match(
    upstreamBlock(nginx, 'api'),
    /zone api 64k;\s+server api\.example\.test:443 resolve;/,
  );

  const api = locationBlock(nginx, '/api/');
  assert.match(api, /auth_request\s+\/oauth2\/auth;/);
  assert.match(api, /proxy_set_header Host api\.example\.test;/);
  assert.match(api, /proxy_set_header Authorization \$authorization;/);
  assert.match(api, /proxy_ssl_server_name on;/);
  assert.match(api, /proxy_ssl_name api\.example\.test;/);
  assert.match(api, /proxy_pass https:\/\/api;/);
});

test('writeNginxConfig supports explicit access-token forwarding', (t) => {
  const config = resolvedConfig(t, {
    upstreams: {
      api: {
        port: 8080,
        locations: {
          '/api/': {
            auth: { forward: 'access' },
          },
        },
      },
    },
  });

  writeNginxConfig(config);

  const nginx = readGenerated(config, config.files.nginx[0]);
  const api = locationBlock(nginx, '/api/');
  assert.match(api, /proxy_set_header Authorization "Bearer \$access_token";/);
  assert.doesNotMatch(api, /proxy_set_header Authorization \$authorization;/);
});

test('writeNginxConfig does not duplicate root locations for root external IdP issuers', (t) => {
  const config = resolvedConfig(t, {
    idp: {
      issuer: 'https://idp.example.test',
      authorization: '/oauth2/v2/authorize?prompt=login',
      token: '/oauth2/v2/token',
      jwks: '/oauth2/v2/jwks',
    },
  });

  writeNginxConfig(config);

  const nginx = readGenerated(config, config.files.nginx[0]);
  assert.equal(locationCount(nginx, '/'), 1);
  assert.doesNotMatch(nginx, /proxy_pass https:\/\/idp;/);
});

test('writeNginxConfig does not render external IdP upstream locations', (t) => {
  const config = resolvedConfig(t, {
    idp: {
      issuer: 'https://idp.example.test/idp',
    },
  });

  writeNginxConfig(config);

  const nginx = readGenerated(config, config.files.nginx[0]);
  assert.equal(locationCount(nginx, '/idp'), 0);
  assert.doesNotMatch(nginx, /proxy_pass https:\/\/idp;/);
});

test('writeDexConfig renders OIDC endpoints and verifiable static users', (t) => {
  const config = resolvedConfig(t);

  writeDexConfig(config);

  const dex = parse(readGenerated(config, config.files.dex[0]));
  assert.equal(dex.issuer, 'https://app.local.test:9443/dex');
  assert.deepEqual(dex.storage, { type: 'memory' });
  assert.deepEqual(dex.web, { http: '0.0.0.0:5556' });
  assert.deepEqual(dex.staticClients, [
    {
      id: 'visage',
      name: 'Visage',
      secret: 'visage-secret',
      redirectURIs: ['https://app.local.test:9443/oauth2/callback'],
    },
  ]);
  assert.equal(dex.staticPasswords[0].email, 'user@example.com');
  assert.equal(dex.staticPasswords[0].username, 'user');
  assert.equal(dex.staticPasswords[0].userID, 'user@example.com');
  assert.equal(compareSync('pass', dex.staticPasswords[0].hash), true);
});

test('writeDexConfig renders configured OAuth2 public client', (t) => {
  const config = resolvedConfig(t, {
    oauth2: {
      clientId: 'local-app',
      clientSecret: null,
      scopes: ['openid', 'email', 'profile', 'offline_access'],
    },
  });

  writeDexConfig(config);

  const dex = parse(readGenerated(config, config.files.dex[0]));
  assert.deepEqual(dex.staticClients, [
    {
      id: 'local-app',
      name: 'Visage',
      public: true,
      redirectURIs: ['https://app.local.test:9443/oauth2/callback'],
    },
  ]);
});

test('writeDexConfig renders configured expiry and users', (t) => {
  const config = resolvedConfig(t, {
    idp: {
      expiry: {
        idTokens: '10m',
        signingKeys: '6h',
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

  writeDexConfig(config);

  const dex = parse(readGenerated(config, config.files.dex[0]));
  assert.deepEqual(dex.expiry, {
    idTokens: '10m',
    signingKeys: '6h',
    refreshTokens: {
      validIfNotUsedFor: '1h',
      absoluteLifetime: '8h',
      reuseInterval: '10s',
    },
  });
  assert.equal(dex.staticPasswords[0].email, 'admin@example.com');
  assert.equal(dex.staticPasswords[0].username, 'admin');
  assert.equal(dex.staticPasswords[0].userID, 'admin@example.com');
  assert.notEqual(dex.staticPasswords[0].hash, 'secret');
  assert.equal(compareSync('secret', dex.staticPasswords[0].hash), true);
  assert.equal(dex.staticPasswords[1].email, 'reader@example.com');
  assert.equal(dex.staticPasswords[1].username, 'reader');
  assert.equal(dex.staticPasswords[1].userID, 'reader-1');
  assert.equal(
    compareSync('reader-password', dex.staticPasswords[1].hash),
    true,
  );
});

test('writeOauth2ProxyConfig renders deterministic proxy settings', (t) => {
  const config = resolvedConfig(t);
  const expectedCookieSecret = createHash('sha256')
    .update('visage:cookie-secret\0')
    .update(config.cache)
    .digest('base64url');

  writeOauth2ProxyConfig(config);

  const oauth2Proxy = parseKeyValueConfig(
    readGenerated(config, config.files.oauth2Proxy[0]),
  );
  assert.equal(oauth2Proxy.http_address, '0.0.0.0:4180');
  assert.equal(oauth2Proxy.oidc_issuer_url, 'https://app.local.test:9443/dex');
  assert.equal(oauth2Proxy.skip_oidc_discovery, true);
  assert.equal(oauth2Proxy.login_url, 'https://app.local.test:9443/dex/auth');
  assert.equal(oauth2Proxy.redeem_url, 'http://dex:5556/dex/token');
  assert.equal(oauth2Proxy.oidc_jwks_url, 'http://dex:5556/dex/keys');
  assert.equal(
    oauth2Proxy.redirect_url,
    'https://app.local.test:9443/oauth2/callback',
  );
  assert.equal(oauth2Proxy.client_id, 'visage');
  assert.equal(oauth2Proxy.client_secret, 'visage-secret');
  assert.equal(oauth2Proxy.cookie_secret, expectedCookieSecret);
  assert.equal(oauth2Proxy.cookie_name, '__Host-sess');
  assert.equal(oauth2Proxy.cookie_expire, '8h');
  assert.equal(oauth2Proxy.cookie_refresh, '15m');
  assert.equal(oauth2Proxy.cookie_httponly, true);
  assert.equal(oauth2Proxy.cookie_secure, true);
  assert.equal(oauth2Proxy.cookie_samesite, 'lax');
  assert.equal(oauth2Proxy.cookie_csrf_per_request, true);
  assert.equal(oauth2Proxy.cookie_csrf_per_request_limit, '16');
  assert.equal(oauth2Proxy.cookie_path, '/');
  assert.deepEqual(oauth2Proxy.email_domains, ['example.com']);
  assert.equal(oauth2Proxy.scope, 'openid email profile offline_access');
  assert.equal(oauth2Proxy.set_xauthrequest, true);
  assert.equal(oauth2Proxy.set_authorization_header, true);
  assert.equal(oauth2Proxy.pass_access_token, true);
  assert.equal(oauth2Proxy.upstreams, undefined);
  assert.deepEqual(oauth2Proxy.whitelist_domains, [
    'app.local.test',
    'app.local.test:9443',
  ]);
});

test('writeOauth2ProxyConfig renders configured OAuth2 public client', (t) => {
  const config = resolvedConfig(t, {
    oauth2: {
      clientId: 'local-app',
      clientSecret: null,
      scopes: ['openid', 'email', 'profile', 'offline_access'],
      emailDomains: ['example.test'],
    },
  });

  writeOauth2ProxyConfig(config);

  const oauth2Proxy = parseKeyValueConfig(
    readGenerated(config, config.files.oauth2Proxy[0]),
  );
  assert.equal(oauth2Proxy.client_id, 'local-app');
  assert.equal(oauth2Proxy.client_secret, undefined);
  assert.equal(
    oauth2Proxy.client_secret_file,
    '/etc/oauth2-proxy/client-secret',
  );
  assert.equal(oauth2Proxy.code_challenge_method, 'S256');
  assert.equal(oauth2Proxy.scope, 'openid email profile offline_access');
  assert.deepEqual(oauth2Proxy.email_domains, ['example.test']);
  assert.equal(readGenerated(config, config.files.clientSecret[0]), '');
});

test('writeOauth2ProxyConfig renders configured external IdP endpoints', (t) => {
  const config = resolvedConfig(t, {
    idp: {
      issuer: 'http://idp.localhost:5557/idp',
    },
  });

  writeOauth2ProxyConfig(config);

  const oauth2Proxy = parseKeyValueConfig(
    readGenerated(config, config.files.oauth2Proxy[0]),
  );
  assert.equal(oauth2Proxy.oidc_issuer_url, 'http://idp.localhost:5557/idp');
  assert.equal(oauth2Proxy.login_url, 'http://idp.localhost:5557/idp/auth');
  assert.equal(oauth2Proxy.redeem_url, 'http://idp.localhost:5557/idp/token');
  assert.equal(oauth2Proxy.oidc_jwks_url, 'http://idp.localhost:5557/idp/keys');
});

test('writeOauth2ProxyConfig renders configured cookie policy', (t) => {
  const config = resolvedConfig(t, {
    cookie: {
      name: 'custom',
      expire: '30m',
      refresh: '5m',
      domains: ['.local.test'],
      path: '/app/',
    },
  });

  writeOauth2ProxyConfig(config);

  const oauth2Proxy = parseKeyValueConfig(
    readGenerated(config, config.files.oauth2Proxy[0]),
  );
  assert.equal(oauth2Proxy.cookie_name, 'custom');
  assert.equal(oauth2Proxy.cookie_expire, '30m');
  assert.equal(oauth2Proxy.cookie_refresh, '5m');
  assert.equal(oauth2Proxy.cookie_httponly, true);
  assert.equal(oauth2Proxy.cookie_secure, true);
  assert.equal(oauth2Proxy.cookie_samesite, 'lax');
  assert.deepEqual(oauth2Proxy.cookie_domains, ['.local.test']);
  assert.equal(oauth2Proxy.cookie_path, '/app/');
});
