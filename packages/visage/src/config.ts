import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { parse } from 'yaml';

import type {
  VisageDexExpiry,
  VisageDexOptions,
  VisageDexUser,
  VisageExternalIdpOptions,
  VisageOptions,
  VisageProxyPolicy,
  VisageService,
  VisageUpstream,
} from './types';

type Volume = readonly [from: string, to: string];

type ResolvedCookiePolicy = {
  readonly cookie_name: string;
  readonly cookie_expire: string;
  readonly cookie_refresh: string;
  readonly cookie_domains?: readonly string[];
  readonly cookie_path: string;
};

type ResolvedIdpOption =
  | { readonly dex: VisageDexOptions }
  | VisageExternalIdpOptions;

type ResolvedOAuth2Client = {
  readonly id: string;
  readonly secret?: string;
  readonly scopes: readonly string[];
  readonly emailDomains: readonly string[];
  readonly public: boolean;
};

type ResolvedProxyPolicy = {
  readonly auth: {
    readonly enabled: boolean;
    readonly forward: false | 'id' | 'access';
    readonly redirect: boolean;
  };
  readonly csrf: false | 'app' | 'api';
  readonly headers: Readonly<Record<string, string>>;
  readonly directives: Readonly<Record<string, readonly string[]>>;
};

type ResolvedUpstream = {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly locations: Readonly<Record<string, ResolvedProxyPolicy>>;
};

type ResolvedVisageOptions = {
  readonly host: string;
  readonly port: number;
  readonly cookie: ResolvedCookiePolicy;
  readonly idp: ResolvedIdpOption;
  readonly oauth2: ResolvedOAuth2Client;
  readonly services: Readonly<Record<string, VisageService>>;
  readonly upstreams: Record<string, ResolvedUpstream>;
};

type OIDCEndpointConfig = {
  readonly issuer: string;
  readonly authorization?: string;
  readonly token?: string;
  readonly jwks?: string;
  readonly algs?: readonly string[];
  readonly end_session_endpoint?: string;
};

type ManualOIDCEndpointConfig = OIDCEndpointConfig & {
  readonly authorization: string;
  readonly token: string;
  readonly jwks: string;
};

type ResolvedDexIdpConfig = {
  readonly dex: {
    readonly expiry?: VisageDexExpiry;
    readonly users: readonly VisageDexUser[];
  };
  readonly oidc: ManualOIDCEndpointConfig;
  readonly upstream: { readonly dex: ResolvedUpstream };
};
type ResolvedExternalIdpConfig = {
  readonly oidc: OIDCEndpointConfig;
  readonly upstream: { readonly idp: ResolvedUpstream };
};
type ResolvedIdpConfig = ResolvedDexIdpConfig | ResolvedExternalIdpConfig;

type ResolvedService = Omit<VisageService, 'upstream'> & {
  readonly restart: NonNullable<VisageService['restart']>;
};

type ResolvedConfigUpstream = ResolvedUpstream & {
  readonly external: boolean;
};

export type VisageConfig = {
  readonly host: string;
  readonly port: number;
  readonly cookie: ResolvedCookiePolicy;
  readonly edgeKey: string;
  readonly idp: ResolvedIdpConfig;
  readonly oauth2: ResolvedOAuth2Client;

  readonly cache: string;
  readonly files: {
    readonly certs: Volume;
    readonly compose: string;
    readonly dex: Volume;
    readonly nginx: Volume;
    readonly nginxEdgeKeyJS: Volume;
    readonly oauth2Proxy: Volume;
  };
  readonly secrets: {
    readonly cookieSecret: string;
    readonly clientSecret: string;
    readonly edgeKey: string;
  };
  readonly compose: {
    readonly name: string;
    readonly network: {
      readonly trustedProxyIps: readonly string[];
    };
  };

  readonly services: Readonly<Record<string, ResolvedService>>;
  readonly upstreams: Readonly<Record<string, ResolvedConfigUpstream>>;
};

export const VisageEdgeKeyHeader = 'X-Visage-Edge-Key';

const DockerImages = parse(
  readFileSync(
    new URL('../docker-compose.images.yml', import.meta.url),
    'utf8',
  ),
).services as Record<'dex' | 'nginx' | 'oauth2_proxy', { image: string }>;

const BaseServiceDex = {
  image: DockerImages.dex.image,
  command: ['dex', 'serve', '/etc/dex/dex.yaml'],
  restart: 'always',
} as const satisfies ResolvedService;

const BaseServiceNginx = {
  image: DockerImages.nginx.image,
  depends_on: ['oauth2_proxy'],
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'always',
} as const satisfies ResolvedService;

const BaseServiceOAuth2Proxy = {
  image: DockerImages.oauth2_proxy.image,
  command: ['--config', '/etc/oauth2-proxy/config.yml'],
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'always',
} as const satisfies ResolvedService;

const DefaultProxyPolicy = {
  auth: { enabled: true, forward: false, redirect: false },
  csrf: 'api',
  headers: {
    Host: '$host',

    // Mitigate header injection by clearing auth headers.
    Authorization: '""',
    Cookie: '""',
    'X-Auth-Request-User': '""',
    'X-Auth-Request-Email': '""',
    'X-Auth-Request-Groups': '""',
    'X-Auth-Request-Preferred-Username': '""',

    // Add common proxy headers.
    'X-Real-IP': '$remote_addr',
    'X-Forwarded-For': '$proxy_add_x_forwarded_for',
    'X-Forwarded-Proto': '$scheme',
  },
  directives: {
    proxy_buffer_size: ['8k'],
  },
} as const satisfies ResolvedProxyPolicy;

const BaseUpstreamOauth2Proxy = {
  host: 'oauth2_proxy',
  scheme: 'http',
  port: 4180,
  locations: {
    '/oauth2/': {
      auth: { enabled: false, forward: false, redirect: false },
      csrf: false,
      headers: {
        ...DefaultProxyPolicy.headers,
        Cookie: '$http_cookie', // Forward session cookie.
        'X-Auth-Request-Redirect': '$request_uri',
      },
      directives: { ...DefaultProxyPolicy.directives },
    } satisfies ResolvedProxyPolicy,
    '= /oauth2/auth': {
      auth: { enabled: false, forward: false, redirect: false },
      csrf: false,
      headers: {
        ...DefaultProxyPolicy.headers,
        Cookie: '$http_cookie', // Forward session cookie.
        'Content-Length': '""',
      },
      directives: {
        ...DefaultProxyPolicy.directives,
        internal: [''],
        proxy_pass_request_body: ['off'],
      },
    } satisfies ResolvedProxyPolicy,
    '/oauth2/sign_out': {
      auth: { enabled: false, forward: false, redirect: false },
      csrf: false,
      headers: {
        ...DefaultProxyPolicy.headers,
        Cookie: '$http_cookie', // Forward session cookie.
        'X-Auth-Request-Redirect': '/',
      },
      directives: { ...DefaultProxyPolicy.directives },
    } satisfies ResolvedProxyPolicy,
  },
} as const satisfies ResolvedUpstream;

const DefaultCookiePolicy = {
  cookie_expire: '8h',
  cookie_refresh: '15m',
  cookie_path: '/',
} as const satisfies Omit<ResolvedCookiePolicy, 'cookie_name'>;

const DefaultDexUsers: readonly VisageDexUser[] = [
  { email: 'user@example.com', password: 'pass' },
];

const DefaultOAuth2Client = {
  id: 'visage',
  secret: 'visage-secret',
  scopes: ['openid', 'email', 'profile', 'offline_access'],
  emailDomains: ['example.com'],
  public: false,
} as const satisfies ResolvedOAuth2Client;

export function resolveOptions(options: VisageOptions): ResolvedVisageOptions {
  const {
    host = 'localhost',
    port = 9001,
    cookie = {},
    idp = {},
    oauth2 = {},
  } = options;
  const cookieName = cookie.name ?? 'sess';
  const publicClient = oauth2.clientSecret === null;
  const services = resolveServicesOptions(options.services);
  return {
    host,
    port,
    cookie: {
      ...DefaultCookiePolicy,
      cookie_name:
        cookie.domains === undefined
          ? cookieName.startsWith('__Host-')
            ? cookieName
            : `__Host-${cookieName}`
          : cookieName,
      ...(cookie.expire === undefined ? {} : { cookie_expire: cookie.expire }),
      ...(cookie.refresh === undefined
        ? {}
        : { cookie_refresh: cookie.refresh }),
      ...(cookie.domains === undefined
        ? {}
        : { cookie_domains: cookie.domains }),
      ...(cookie.path === undefined ? {} : { cookie_path: cookie.path }),
    } satisfies ResolvedCookiePolicy,
    idp:
      'issuer' in idp
        ? idp
        : ({
            dex: {
              ...(idp.expiry ? { expiry: idp.expiry } : {}),
              users: (idp.users ?? DefaultDexUsers).map((user) => ({
                email: user.email,
                password: user.password,
                username: user.username ?? user.email.split('@', 1)[0],
                userID: user.userID ?? user.email,
              })),
            },
          } satisfies ResolvedIdpOption),
    oauth2: {
      id: oauth2.clientId ?? DefaultOAuth2Client.id,
      ...(publicClient
        ? {}
        : { secret: oauth2.clientSecret ?? DefaultOAuth2Client.secret }),
      scopes: oauth2.scopes ?? DefaultOAuth2Client.scopes,
      emailDomains: oauth2.emailDomains ?? DefaultOAuth2Client.emailDomains,
      public: publicClient,
    } satisfies ResolvedOAuth2Client,
    services,
    upstreams: resolveUpstreamsOptions(services, options.upstreams),
  } satisfies ResolvedVisageOptions;
}

function resolveServicesOptions(
  services: Record<string, VisageService> | undefined = {},
): Record<string, VisageService> {
  return {
    ...services,
    nginx: {
      ...BaseServiceNginx,
      ...{
        ...(services.nginx ?? {}),
        extra_hosts: [
          ...BaseServiceNginx.extra_hosts,
          ...(services.nginx?.extra_hosts ?? []),
        ],
      },
    },
    oauth2_proxy: {
      ...BaseServiceOAuth2Proxy,
      ...{
        ...(services.oauth2_proxy ?? {}),
        extra_hosts: [
          ...BaseServiceOAuth2Proxy.extra_hosts,
          ...(services.oauth2_proxy?.extra_hosts ?? []),
        ],
      },
    },
  };
}

function resolveUpstreamsOptions(
  services: Record<string, VisageService>,
  upstreams: Record<string, VisageUpstream> = {},
): Record<string, ResolvedUpstream> {
  return {
    ...Object.fromEntries(
      Object.entries(services)
        .filter(
          ([name]) =>
            // Exclude base services handled separately.
            name !== 'dex' && name !== 'nginx' && name !== 'oauth2_proxy',
        )
        .map(([name, service]) => [
          name,
          resolveUpstreamOptions(name, service.upstream, false),
        ]),
    ),
    ...Object.fromEntries(
      Object.entries(upstreams).map(([name, upstream]) => {
        if (name === 'vite') {
          const vite = resolveViteUpstreamOptions(upstream);
          return [name, resolveUpstreamOptions('vite', vite, true)];
        }
        return [
          name,
          resolveUpstreamOptions(name, upstream, services[name] === undefined),
        ];
      }),
    ),
  };
}

const BaseViteUpstreamRootLocation = {
  auth: { enabled: true, forward: false, redirect: true },
  csrf: 'app',
  headers: {
    Host: '$host',
    Upgrade: '$http_upgrade',
    Connection: '$connection_upgrade',
    'X-Auth-Request-User': '$auth_user',
    'X-Auth-Request-Email': '$auth_email',
  },
  directives: {
    proxy_http_version: ['1.1'],
    proxy_read_timeout: ['1h'],
  },
} satisfies ResolvedProxyPolicy;

function resolveViteUpstreamOptions(upstream: VisageUpstream): VisageUpstream {
  const base = BaseViteUpstreamRootLocation;
  const root = upstream.locations?.['/'];
  return {
    host: 'host.docker.internal',
    scheme: 'http',
    ...upstream,
    locations: {
      ...(upstream.locations ?? {}),
      '/':
        root === undefined
          ? { ...base }
          : {
              auth: { ...base.auth, ...root.auth },
              csrf: root.csrf ?? base.csrf,
              headers: {
                ...base.headers,
                ...root.headers,
              },
              directives: {
                ...base.directives,
                ...root.directives,
              },
            },
    },
  } satisfies VisageUpstream;
}

function resolveUpstreamOptions(
  name: string,
  upstream: VisageUpstream = {},
  external: boolean,
): ResolvedUpstream {
  const scheme = upstream.scheme ?? (external ? 'https' : 'http');
  const host = upstream.host ?? name;
  return {
    ...upstream,
    scheme,
    host,
    port: upstream.port ?? (scheme === 'https' ? 443 : 80),
    locations: {
      ...Object.fromEntries(
        Object.entries(upstream.locations ?? { [`/${name}/`]: {} }).map(
          ([path, policy]) => [
            path,
            resolveUpstreamLocationOptions(name, host, policy, external),
          ],
        ),
      ),
    } satisfies Record<string, ResolvedProxyPolicy>,
  };
}

function resolveUpstreamLocationOptions(
  name: string,
  host: string,
  location: VisageProxyPolicy,
  external: boolean,
): ResolvedProxyPolicy {
  const auth = resolveAuthPolicy(location.auth, external && name !== 'vite');
  return {
    ...DefaultProxyPolicy,
    ...location,
    auth,
    csrf: location.csrf ?? (auth.enabled ? 'api' : false),
    headers: {
      ...DefaultProxyPolicy.headers,
      ...(external ? { Host: host } : {}),
      ...(auth.enabled && auth.forward === 'id'
        ? { Authorization: '$authorization' }
        : {}),
      ...(auth.enabled && auth.forward === 'access'
        ? { Authorization: '"Bearer $access_token"' }
        : {}),
      ...(location.headers ?? {}),
    } satisfies ResolvedProxyPolicy['headers'],
    directives: {
      ...DefaultProxyPolicy.directives,
      ...Object.fromEntries(
        Object.entries(location.directives ?? {}).map(([name, value]) => [
          name,
          Array.isArray(value) ? value : [value],
        ]),
      ),
    } satisfies ResolvedProxyPolicy['directives'],
  } satisfies ResolvedProxyPolicy;
}

function resolveAuthPolicy(
  auth: VisageProxyPolicy['auth'] = {},
  external: boolean,
) {
  return {
    enabled: auth.enabled ?? true,
    forward:
      auth.forward === true
        ? external
          ? 'access'
          : 'id'
        : (auth.forward ?? false),
    redirect: auth.redirect ?? false,
  } satisfies ResolvedProxyPolicy['auth'];
}

export function resolveConfig(
  options: ResolvedVisageOptions & {
    readonly root: string;
    readonly cache: string;
    readonly edgeKey: string;
  },
): VisageConfig {
  const idp = resolveIdpConfig(options);
  const end_session_endpoint = idp.oidc.end_session_endpoint;
  const upstreams: Record<string, ResolvedUpstream> = {
    ...(end_session_endpoint === undefined
      ? { oauth2_proxy: { ...BaseUpstreamOauth2Proxy } }
      : {
          oauth2_proxy: {
            ...BaseUpstreamOauth2Proxy,
            locations: {
              ...BaseUpstreamOauth2Proxy.locations,
              '/oauth2/sign_out': {
                ...BaseUpstreamOauth2Proxy.locations['/oauth2/sign_out'],
                headers: {
                  ...BaseUpstreamOauth2Proxy.locations['/oauth2/sign_out']
                    .headers,
                  'X-Auth-Request-Redirect': JSON.stringify(
                    end_session_endpoint +
                      (end_session_endpoint.includes('?') ? '&' : '?') +
                      'id_token_hint={id_token}&post_logout_redirect_uri=' +
                      encodeURIComponent(
                        `https://${options.host}:${options.port}/`,
                      ),
                  ),
                },
              } satisfies ResolvedProxyPolicy,
            },
          },
        }),
    ...idp.upstream,
    ...options.upstreams,
  };
  return {
    host: options.host,
    port: options.port,
    cookie: options.cookie,
    edgeKey: options.edgeKey,
    idp,
    oauth2: options.oauth2,
    cache: options.cache,
    files: {
      certs: ['./certs', '/etc/nginx/certs'],
      compose: './compose.yaml',
      dex: ['./dex.yaml', '/etc/dex/dex.yaml'],
      nginx: ['./nginx.conf', '/etc/nginx/nginx.conf'],
      nginxEdgeKeyJS: ['./nginx-edge-key.js', '/etc/nginx/edge-key.js'],
      oauth2Proxy: ['./oauth2-proxy.yml', '/etc/oauth2-proxy/config.yml'],
    },
    secrets: {
      cookieSecret: 'OAUTH2_PROXY_COOKIE_SECRET',
      clientSecret: 'OAUTH2_CLIENT_SECRET',
      edgeKey: 'VISAGE_EDGE_KEY',
    },
    compose: {
      name: resolveComposeName(options.root),
      network: { trustedProxyIps: [] },
    },
    services: {
      ...('dex' in idp
        ? {
            dex: BaseServiceDex,
            nginx: { ...BaseServiceNginx, depends_on: ['dex', 'oauth2_proxy'] },
            oauth2_proxy: { ...BaseServiceOAuth2Proxy, depends_on: ['dex'] },
          }
        : { nginx: BaseServiceNginx, oauth2_proxy: BaseServiceOAuth2Proxy }),
      ...Object.fromEntries(
        Object.entries(options.services).map(
          ([name, { upstream: _upstream, ...service }]) => [
            name,
            { restart: 'on-failure', ...service },
          ],
        ),
      ),
    },
    upstreams: Object.fromEntries(
      Object.entries(upstreams).map(([name, upstream]) => {
        const external =
          options.upstreams[name] !== undefined &&
          options.services[name] === undefined;
        return [
          name,
          { ...upstream, external } satisfies ResolvedConfigUpstream,
        ];
      }),
    ),
  };
}

function resolveComposeName(root: string): string {
  const name = (packageName(root) ?? basename(resolve(root)))
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9_-]+/g, '-');
  return `${name}-visage`;
}

function packageName(root: string): string | undefined {
  try {
    return JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ).name.trim();
  } catch {
    return undefined;
  }
}

function resolveIdpConfig({
  host,
  port,
  idp,
}: ResolvedVisageOptions): ResolvedIdpConfig {
  if ('dex' in idp) {
    return {
      dex: {
        expiry: idp.dex.expiry,
        users: (idp.dex?.users ?? DefaultDexUsers).map((user) => ({
          email: user.email,
          password: user.password,
          username: user.username ?? user.email.split('@', 1)[0],
          userID: user.userID ?? user.email,
        })),
      },
      oidc: {
        issuer: `https://${host}:${port}/dex`,
        authorization: `https://${host}:${port}/dex/auth`,
        token: 'http://dex:5556/dex/token',
        jwks: 'http://dex:5556/dex/keys',
      },
      upstream: {
        dex: {
          host: 'dex',
          scheme: 'http',
          port: 5556,
          locations: {
            '/dex/': {
              auth: { enabled: false, forward: false, redirect: false },
              csrf: false,
              headers: { ...DefaultProxyPolicy.headers },
              directives: { ...DefaultProxyPolicy.directives },
            } satisfies ResolvedProxyPolicy,
          },
        },
      },
    } satisfies ResolvedDexIdpConfig;
  }
  const issuer = new URL(idp.issuer);
  const oidc = {
    issuer: idp.issuer,
    ...(idp.algs === undefined ? {} : { algs: idp.algs }),
    ...(idp.end_session_endpoint === undefined
      ? {}
      : { end_session_endpoint: idp.end_session_endpoint }),
  } as const;
  return {
    oidc:
      !idp.authorization && !idp.token && !idp.jwks
        ? oidc
        : {
            ...oidc,
            authorization: idp.issuer + (idp.authorization ?? '/auth'),
            token: idp.issuer + (idp.token ?? '/token'),
            jwks: idp.issuer + (idp.jwks ?? '/keys'),
          },
    upstream: {
      idp: {
        scheme: issuer.protocol === 'https:' ? 'https' : 'http',
        host: issuer.hostname,
        port: Number(issuer.port) || (issuer.protocol === 'https:' ? 443 : 80),
        locations: {},
      },
    },
  } satisfies ResolvedExternalIdpConfig;
}
