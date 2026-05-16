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
  readonly cookie_secret_file: string;
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

type ResolvedVisageOptions = {
  readonly host: string;
  readonly port: number;
  readonly cookie: ResolvedCookiePolicy;
  readonly idp: ResolvedIdpOption;
  readonly oauth2: ResolvedOAuth2Client;
  readonly services: Readonly<Record<string, VisageService>>;
  readonly upstreams: Record<string, VisageUpstream>;
};

type OIDCEndpointConfig = {
  readonly issuer: string;
  readonly authorization: string;
  readonly token: string;
  readonly jwks: string;
};
type ResolvedDexIdpConfig = {
  readonly dex: {
    readonly expiry?: VisageDexExpiry;
    readonly users: readonly VisageDexUser[];
  };
  readonly oidc: OIDCEndpointConfig;
  readonly upstream: { readonly dex: ResolvedUpstream };
};
type ResolvedExternalIdpConfig = {
  readonly oidc: { readonly issuer: string } | OIDCEndpointConfig;
  readonly upstream: { readonly idp: ResolvedUpstream };
};
type ResolvedIdpConfig = ResolvedDexIdpConfig | ResolvedExternalIdpConfig;

type ResolvedService = Omit<VisageService, 'upstream'> & {
  readonly restart: NonNullable<VisageService['restart']>;
};

type ResolvedUpstream = {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly locations: Readonly<Record<string, VisageProxyPolicy>>;
};

type ResolvedAuthPolicy = {
  readonly enabled: boolean;
  readonly forward: false | 'id' | 'access';
  readonly redirect: boolean;
};

type ResolvedProxyPolicy = {
  readonly auth: ResolvedAuthPolicy;
  readonly headers: Readonly<Record<string, string>>;
  readonly directives: Readonly<Record<string, readonly string[]>>;
};

type ResolvedConfigUpstream = Omit<ResolvedUpstream, 'locations'> & {
  readonly locations: Readonly<Record<string, ResolvedProxyPolicy>>;
  readonly external: boolean;
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
    readonly clientSecret: Volume;
    readonly cookieSecret: Volume;
  };
  readonly network: {
    readonly name: string;
    readonly trustedProxyIps: readonly string[];
  };

  readonly services: Readonly<Record<string, ResolvedService>>;
  readonly upstreams: Readonly<Record<string, ResolvedConfigUpstream>>;
};

const BaseFiles = {
  certs: ['./certs', '/etc/nginx/certs'],
  compose: './compose.yaml',
  dex: ['./dex.yml', '/etc/dex/dex.yml'],
  nginx: ['./nginx.conf', '/etc/nginx/nginx.conf'],
  oauth2Proxy: ['./oauth2-proxy.yml', '/etc/oauth2-proxy/config.yml'],
  clientSecret: ['./oauth2-client-secret', '/etc/oauth2-proxy/client-secret'],
  cookieSecret: ['./oauth2-cookie-secret', '/etc/oauth2-proxy/cookie-secret'],
} as const satisfies VisageConfig['files'];

const BaseServiceDex = {
  image: 'ghcr.io/dexidp/dex:v2.45.1',
  command: ['dex', 'serve', '/etc/dex/dex.yml'],
  restart: 'always',
} as const satisfies ResolvedService;

const BaseServiceNginx = {
  image: 'nginx:1.30.0-alpine',
  depends_on: ['oauth2_proxy'],
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'always',
} as const satisfies ResolvedService;

const BaseServiceOAuth2Proxy = {
  image: 'quay.io/oauth2-proxy/oauth2-proxy:v7.15.2',
  command: ['--config', '/etc/oauth2-proxy/config.yml'],
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'always',
} as const satisfies ResolvedService;

const BaseUpstreamOauth2Proxy = {
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

const DefaultCookiePolicy = {
  cookie_expire: '8h',
  cookie_refresh: '15m',
  cookie_path: '/',
  cookie_secret_file: BaseFiles.cookieSecret[1],
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

const DefaultProxyPolicy = {
  auth: { enabled: true, forward: false, redirect: false },
  headers: {
    Cookie: '""', // Don't forward session cookie.
    Host: '$host',
    'X-Real-IP': '$remote_addr',
    'X-Forwarded-For': '$proxy_add_x_forwarded_for',
    'X-Forwarded-Proto': '$scheme',
  },
  directives: {
    proxy_buffer_size: ['8k'],
  },
} as const satisfies VisageProxyPolicy;

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

export function resolveConfig(
  options: ResolvedVisageOptions,
  cache: string,
): VisageConfig {
  const idp = resolveIdpConfig(options);
  const upstreams: Record<string, ResolvedUpstream> = {
    oauth2_proxy: BaseUpstreamOauth2Proxy,
    ...idp.upstream,
    ...options.upstreams,
  };
  return {
    host: options.host,
    port: options.port,
    cookie: options.cookie,
    idp,
    oauth2: options.oauth2,
    cache,
    files: BaseFiles,
    network: {
      name: `${process.env.COMPOSE_PROJECT_NAME ?? 'visage'}_nginx`,
      trustedProxyIps: [],
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
          {
            ...upstream,
            external,
            locations: Object.fromEntries(
              Object.entries(upstream.locations ?? {}).map(([path, policy]) => [
                path,
                {
                  auth: resolveAuthPolicy(
                    policy.auth,
                    external && name !== 'vite',
                  ),
                  headers: {
                    ...(external
                      ? { ...DefaultProxyPolicy.headers, Host: upstream.host }
                      : DefaultProxyPolicy.headers),
                    ...policy.headers,
                  },
                  directives: {
                    ...DefaultProxyPolicy.directives,
                    ...Object.fromEntries(
                      Object.entries(policy.directives ?? {}).map(
                        ([name, value]) => [
                          name,
                          Array.isArray(value) ? value : [value],
                        ],
                      ),
                    ),
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
          locations: { '/dex/': { auth: { enabled: false } } },
        },
      },
    } satisfies ResolvedDexIdpConfig;
  }
  const issuer = new URL(idp.issuer);
  return {
    oidc:
      !idp.authorization && !idp.token && !idp.jwks
        ? { issuer: idp.issuer }
        : {
            issuer: idp.issuer,
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

function resolveAuthPolicy(
  auth: VisageProxyPolicy['auth'] = {},
  external: boolean,
): ResolvedAuthPolicy {
  return {
    enabled: auth.enabled ?? true,
    forward:
      auth.forward === true
        ? external
          ? 'access'
          : 'id'
        : (auth.forward ?? false),
    redirect: auth.redirect ?? false,
  };
}

const BaseViteUpstream = {
  host: 'host.docker.internal',
  scheme: 'http',
  locations: {
    '/': {
      auth: { redirect: true },
      headers: {
        Host: '$host',
        Upgrade: '$http_upgrade',
        Connection: '$connection_upgrade',
      },
      directives: {
        proxy_http_version: '1.1',
        proxy_read_timeout: '1h',
      },
    },
  },
} as const satisfies Omit<ResolvedUpstream, 'port'>;

export function resolveViteUpstream(
  vite: VisageUpstream = { locations: {} },
): VisageUpstream {
  return {
    ...BaseViteUpstream,
    ...vite,
    locations: {
      ...BaseViteUpstream.locations,
      ...Object.fromEntries(
        Object.entries(vite.locations ?? {}).map(([path, policy]) => {
          if (path !== '/') return [path, policy];
          const defaults = BaseViteUpstream.locations['/'];
          return [
            path,
            {
              ...defaults,
              ...policy,
              auth: { ...defaults.auth, ...policy.auth },
              headers: { ...defaults.headers, ...policy.headers },
              directives: { ...defaults.directives, ...policy.directives },
            },
          ];
        }),
      ),
    },
  };
}
