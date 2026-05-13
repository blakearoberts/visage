import { join } from 'node:path';
import type { ResolvedConfig } from 'vite';

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
  | {
      readonly dex: VisageDexOptions;
    }
  | VisageExternalIdpOptions;

type ResolvedOAuth2Client = {
  readonly id: string;
  readonly secret?: string;
  readonly scopes: readonly string[];
  readonly public: boolean;
};

type ResolvedVisageOptions = {
  readonly host: string;
  readonly port: number;
  readonly cookie: ResolvedCookiePolicy;
  readonly idp: ResolvedIdpOption;
  readonly oauth2: ResolvedOAuth2Client;
  readonly services: Readonly<Record<string, VisageService>>;
  readonly upstreams: Record<string, VisageUpstream>;
};

type ResolvedBaseIdpConfig = {
  readonly upstream: string;
  readonly issuer: string;
  readonly authorization: string;
  readonly token: string;
  readonly jwks: string;
};
type ResolvedDexIdpConfig = ResolvedBaseIdpConfig & {
  readonly dex: {
    readonly expiry?: VisageDexExpiry;
    readonly users: readonly VisageDexUser[];
  };
};
type ResolvedExternalIdpConfig = ResolvedBaseIdpConfig & {
  readonly dex?: never;
};
type ResolvedIdpConfig = ResolvedDexIdpConfig | ResolvedExternalIdpConfig;

type ResolvedService = Omit<VisageService, 'upstream'>;

type ResolvedUpstream = {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly locations: Readonly<Record<string, VisageProxyPolicy>>;
};

type ResolvedProxyPolicy = {
  readonly auth: Required<VisageProxyPolicy['auth']>;
  readonly headers: VisageProxyPolicy['headers'];
};

type ResolvedConfigUpstream = Omit<ResolvedUpstream, 'locations'> & {
  readonly locations: Readonly<Record<string, ResolvedProxyPolicy>>;
};

export type VisageConfig = {
  readonly host: string;
  readonly port: number;
  readonly cookie: ResolvedCookiePolicy;
  readonly idp: ResolvedIdpConfig;
  readonly oauth2: ResolvedOAuth2Client;

  readonly cache: string;
  readonly files: {
    readonly certs: Volume;
    readonly compose: string;
    readonly dex: Volume;
    readonly nginx: Volume;
    readonly oauth2Proxy: Volume;
    readonly oauth2ProxyClientSecret: Volume;
  };

  readonly services: Readonly<Record<string, ResolvedService>>;
  readonly upstreams: Readonly<Record<string, ResolvedConfigUpstream>>;
};

const BaseFiles = {
  certs: ['./certs', '/etc/nginx/certs'],
  compose: './compose.yaml',
  dex: ['./dex.yml', '/etc/dex/dex.yml'],
  nginx: ['./nginx.conf', '/etc/nginx/nginx.conf'],
  oauth2ProxyClientSecret: [
    './oauth2-client-secret',
    '/etc/oauth2-proxy/client-secret',
  ],
  oauth2Proxy: ['./oauth2-proxy.yml', '/etc/oauth2-proxy/config.yml'],
} as const satisfies VisageConfig['files'];

const BaseDexService = {
  image: 'ghcr.io/dexidp/dex:v2.45.1',
  command: ['dex', 'serve', '/etc/dex/dex.yml'],
} as const satisfies ResolvedService;

const BaseServiceNginx = {
  image: 'nginx:1.30.0-alpine',
  depends_on: ['oauth2_proxy'],
  extra_hosts: ['host.docker.internal:host-gateway'],
} as const satisfies ResolvedService;

const BaseOAuth2ProxyService = {
  image: 'quay.io/oauth2-proxy/oauth2-proxy:v7.15.2',
  command: ['--config', '/etc/oauth2-proxy/config.yml'],
  extra_hosts: ['host.docker.internal:host-gateway'],
} as const satisfies ResolvedService;

const BaseServices = {
  nginx: BaseServiceNginx,
  oauth2_proxy: BaseOAuth2ProxyService,
} as const satisfies Readonly<Record<string, ResolvedService>>;

const BaseDexUpstream = {
  host: 'dex',
  scheme: 'http',
  port: 5556,
  locations: { '/dex/': { auth: { enabled: false } } },
} as const satisfies ResolvedUpstream;

const BaseOauth2ProxyUpstream = {
  host: 'oauth2_proxy',
  scheme: 'http',
  port: 4180,
  locations: {
    '/oauth2/': {
      auth: { enabled: false },
      headers: {
        Cookie: '$http_cookie', // Forward session cookie.
        'X-Auth-Request-Redirect': '$request_uri',
      },
    },
  },
} as const satisfies ResolvedUpstream;

const BaseViteUpstream = {
  host: 'host.docker.internal',
  scheme: 'http',
  locations: {
    '/': {
      auth: { forward: false, redirect: true },
      headers: {
        Upgrade: '$http_upgrade',
        Connection: '$connection_upgrade',
      },
    },
  },
} as const satisfies Omit<ResolvedUpstream, 'port'>;

const DefaultCookiePolicy = {
  cookie_expire: '8h',
  cookie_refresh: '15m',
  cookie_path: '/',
} as const satisfies Omit<ResolvedCookiePolicy, 'cookie_name'>;

const DefaultDexUsers: readonly VisageDexUser[] = [
  {
    email: 'user@example.com',
    password: 'pass',
  },
];

const DefaultOAuth2Client = {
  id: 'visage',
  secret: 'visage-secret',
  scopes: ['openid', 'email', 'profile', 'offline_access'],
  public: false,
} as const satisfies ResolvedOAuth2Client;

const DefaultProxyPolicy = {
  auth: { enabled: true, forward: true, redirect: false },
  headers: {
    Cookie: '""', // Don't forward session cookie.
    Host: '$host',
    'X-Real-IP': '$remote_addr',
    'X-Forwarded-For': '$proxy_add_x_forwarded_for',
    'X-Forwarded-Proto': '$scheme',
  },
} as const satisfies VisageProxyPolicy;

export function resolveOptions(options: VisageOptions): ResolvedVisageOptions {
  const { host = 'localhost', port = 9001, cookie = {}, oauth2 = {} } = options;
  const cookieName = cookie.name ?? 'session';
  const publicClient = oauth2.clientSecret === null;
  const services = resolveServicesOptions(options.services);
  const upstreams = resolveUpstreamsOptions(services, options.upstreams);
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
    },
    idp: resolveIdpOption(options.idp),
    oauth2: {
      id: oauth2.clientId ?? DefaultOAuth2Client.id,
      ...(publicClient
        ? {}
        : { secret: oauth2.clientSecret ?? DefaultOAuth2Client.secret }),
      scopes: oauth2.scopes ?? DefaultOAuth2Client.scopes,
      public: publicClient,
    },
    services,
    upstreams,
  };
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
      ...BaseOAuth2ProxyService,
      ...{
        ...(services.oauth2_proxy ?? {}),
        extra_hosts: [
          ...BaseOAuth2ProxyService.extra_hosts,
          ...(services.oauth2_proxy?.extra_hosts ?? []),
        ],
      },
    },
  };
}

function resolveUpstreamsOptions(
  services: Record<string, VisageService>,
  upstreams: Record<string, VisageUpstream> = {},
): Record<string, VisageUpstream> {
  function resolveUpstream(
    name: string,
    upstream: { scheme: 'http' | 'https' } & VisageUpstream,
  ): VisageUpstream {
    return {
      ...upstream,
      scheme: upstream.scheme,
      host: upstream.host ?? name,
      port: upstream.port ?? (upstream.scheme === 'https' ? 443 : 80),
      locations: upstream.locations ?? { [`/${name}/`]: {} },
    };
  }
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
          resolveUpstream(name, { scheme: 'http', ...service.upstream }),
        ]),
    ),
    ...Object.fromEntries(
      Object.entries(upstreams).map(([name, upstream]) => [
        name,
        resolveUpstream(name, {
          scheme: services[name] === undefined ? 'https' : 'http',
          ...upstream,
        }),
      ]),
    ),
  };
}

function resolveIdpOption(
  idp: VisageDexOptions | VisageExternalIdpOptions | undefined,
): ResolvedIdpOption {
  if (idp && 'issuer' in idp) {
    return {
      issuer: idp.issuer,
      authorization: idp.authorization ?? '/auth',
      token: idp.token ?? '/token',
      jwks: idp.jwks ?? '/keys',
    };
  }
  return {
    dex: {
      ...(idp?.expiry ? { expiry: idp.expiry } : {}),
      users: (idp?.users ?? DefaultDexUsers).map((user) => ({
        email: user.email,
        password: user.password,
        username: user.username ?? user.email.split('@', 1)[0],
        userID: user.userID ?? user.email,
      })),
    },
  };
}

function resolveIdpConfig({
  host,
  port,
  idp,
}: ResolvedVisageOptions): ResolvedIdpConfig {
  if ('dex' in idp) {
    const issuer = `https://${host}:${port}/dex`;
    const upstream = `http://dex:5556/dex`;
    return {
      upstream: 'dex',
      issuer,
      authorization: `${issuer}/auth`,
      token: `${upstream}/token`,
      jwks: `${upstream}/keys`,
      dex: {
        expiry: idp.dex.expiry,
        users: (idp.dex?.users ?? DefaultDexUsers).map((user) => ({
          email: user.email,
          password: user.password,
          username: user.username ?? user.email.split('@', 1)[0],
          userID: user.userID ?? user.email,
        })),
      },
    };
  }
  return {
    upstream: 'idp',
    issuer: idp.issuer,
    authorization: idp.issuer + (idp.authorization ?? '/auth'),
    token: idp.issuer + (idp.token ?? '/token'),
    jwks: idp.issuer + (idp.jwks ?? '/keys'),
  };
}

function resolveExternalIdpUpstream(
  idp: ResolvedExternalIdpConfig,
): ResolvedUpstream {
  const issuer = new URL(idp.issuer);
  return {
    host: issuer.hostname,
    locations: {},
    scheme: issuer.protocol === 'https:' ? 'https' : 'http',
    port: Number(issuer.port) || (issuer.protocol === 'https:' ? 443 : 80),
  };
}

export function resolveConfig(
  options: ResolvedVisageOptions,
  config: ResolvedConfig,
  vitePort: number,
): VisageConfig {
  const idp = resolveIdpConfig(options);
  const upstreams: Record<string, ResolvedUpstream> = {
    oauth2_proxy: BaseOauth2ProxyUpstream,
    vite: { ...BaseViteUpstream, port: vitePort },
    ...(idp.dex === undefined
      ? { idp: resolveExternalIdpUpstream(idp) }
      : { dex: BaseDexUpstream }),
    ...options.upstreams,
  };
  return {
    host: options.host,
    port: options.port,
    cookie: options.cookie,
    idp,
    oauth2: options.oauth2,
    cache: join(config.cacheDir, 'visage'),
    files: { ...BaseFiles },
    services: {
      ...(idp.dex === undefined
        ? BaseServices
        : {
            dex: BaseDexService,
            nginx: {
              ...BaseServices.nginx,
              depends_on: ['dex', 'oauth2_proxy'],
            },
            oauth2_proxy: {
              command: BaseServices.oauth2_proxy.command,
              extra_hosts: BaseServices.oauth2_proxy.extra_hosts,
              image: BaseServices.oauth2_proxy.image,
              depends_on: ['dex'],
            },
          }),
      ...Object.fromEntries(
        Object.entries(options.services).map(
          ([name, { upstream: _upstream, ...service }]) => [name, service],
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
          {
            ...upstream,
            locations: Object.fromEntries(
              Object.entries(upstream.locations ?? {}).map(([path, policy]) => [
                path,
                {
                  auth: { ...DefaultProxyPolicy.auth, ...policy.auth },
                  headers: {
                    ...(external
                      ? { ...DefaultProxyPolicy.headers, Host: upstream.host }
                      : DefaultProxyPolicy.headers),
                    ...policy.headers,
                  },
                },
              ]),
            ),
          },
        ];
      }),
    ),
  };
}
