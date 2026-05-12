import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { compareSync } from 'bcryptjs';
import { parse } from 'yaml';

import { resolveConfig, resolveOptions } from '../../src/config.ts';
import { writeComposeConfig } from '../../src/render/compose.ts';
import { writeDexConfig } from '../../src/render/dex.ts';
import { writeNginxConfig } from '../../src/render/nginx.ts';
import { writeOauth2ProxyConfig } from '../../src/render/oauth2-proxy.ts';

function resolvedConfig(t, options = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'visage-render-test-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));

  const config = resolveConfig(
    resolveOptions({
      host: 'app.local.test',
      port: 9443,
      ...options,
    }),
    { cacheDir },
    6173,
  );
  mkdirSync(config.cache, { recursive: true });
  return config;
}

function readGenerated(config, file) {
  return readFileSync(join(config.cache, file), 'utf8');
}

function locationBlock(rendered, path) {
  const marker = `location ${path} {`;
  const start = rendered.indexOf(marker);
  assert.notEqual(start, -1, `expected nginx location for ${path}`);

  const remaining = rendered.slice(start);
  const end = remaining.indexOf('\n        }');
  assert.notEqual(end, -1, `expected nginx location close for ${path}`);
  return remaining.slice(0, end);
}

function locationCount(rendered, path) {
  const pattern = new RegExp(`^\\s*location ${path} \\{`, 'gm');
  return rendered.match(pattern)?.length ?? 0;
}

function parseKeyValueConfig(contents) {
  return Object.fromEntries(
    contents
      .trim()
      .split('\n')
      .map((line) => {
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
  assert.deepEqual(compose.services.dex.volumes, [
    './dex.yml:/etc/dex/dex.yml:ro',
  ]);
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
  assert.deepEqual(compose.services.oauth2_proxy.volumes, [
    './oauth2-proxy.yml:/etc/oauth2-proxy/config.yml:ro',
  ]);
  assert.deepEqual(compose.services.api, {
    image: 'example/api:test',
    command: ['serve'],
    depends_on: ['nginx'],
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
        host: 'api',
        port: 8080,
        locations: {
          '/api/': {
            auth: { redirect: true },
            headers: {
              'X-Service': 'api',
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
  assert.match(nginx, /upstream api \{\s+server api:8080;\s+\}/);

  const api = locationBlock(nginx, '/api/');
  assert.match(api, /auth_request\s+\/oauth2\/auth;/);
  assert.match(
    api,
    /error_page 401 =302 \/oauth2\/start\?rd=\$scheme:\/\/\$http_host\$request_uri;/,
  );
  assert.match(api, /proxy_set_header Cookie "";/);
  assert.match(api, /proxy_set_header X-Service api;/);
  assert.match(api, /proxy_set_header Authorization "Bearer \$access_token";/);
  assert.match(api, /proxy_pass http:\/\/api;/);

  const publicLocation = locationBlock(nginx, '/public/');
  assert.doesNotMatch(publicLocation, /auth_request/);
  assert.doesNotMatch(publicLocation, /Authorization/);
  assert.match(publicLocation, /proxy_set_header Host public\.internal;/);
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
});

test('writeNginxConfig renders HTTPS upstreams with SNI', (t) => {
  const config = resolvedConfig(t, {
    upstreams: {
      api: {
        host: 'api.example.test',
        scheme: 'https',
        port: 443,
        locations: {
          '/api/': {},
        },
      },
    },
  });

  writeNginxConfig(config);

  const nginx = readGenerated(config, config.files.nginx[0]);
  assert.match(nginx, /upstream api \{\s+server api\.example\.test:443;\s+\}/);

  const api = locationBlock(nginx, '/api/');
  assert.match(api, /auth_request\s+\/oauth2\/auth;/);
  assert.match(api, /proxy_set_header Authorization "Bearer \$access_token";/);
  assert.match(api, /proxy_ssl_server_name on;/);
  assert.match(api, /proxy_ssl_name api\.example\.test;/);
  assert.match(api, /proxy_pass https:\/\/api;/);
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
  assert.equal(oauth2Proxy.cookie_name, '__HOST-session');
  assert.equal(oauth2Proxy.cookie_expire, '8h');
  assert.equal(oauth2Proxy.cookie_refresh, '15m');
  assert.equal(oauth2Proxy.cookie_httponly, true);
  assert.equal(oauth2Proxy.cookie_secure, true);
  assert.equal(oauth2Proxy.cookie_samesite, 'lax');
  assert.equal(oauth2Proxy.cookie_path, '/');
  assert.deepEqual(oauth2Proxy.email_domains, ['*']);
  assert.equal(oauth2Proxy.scope, 'openid email profile offline_access');
  assert.deepEqual(oauth2Proxy.upstreams, ['static://202']);
});

test('writeOauth2ProxyConfig renders configured OAuth2 public client', (t) => {
  const config = resolvedConfig(t, {
    oauth2: {
      clientId: 'local-app',
      clientSecret: null,
      scopes: ['openid', 'email', 'profile', 'offline_access'],
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
  assert.equal(
    readGenerated(config, config.files.oauth2ProxyClientSecret[0]),
    '',
  );
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
