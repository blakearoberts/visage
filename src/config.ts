import { join } from 'node:path';
import type { ResolvedConfig } from 'vite';

import type {
  VisageDexExpiry,
  VisageDexOptions,
  VisageDexUser,
  VisageIdpOptions,
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

type ResolvedDexConfig = {
  readonly expiry?: VisageDexExpiry;
  readonly users: readonly Required<VisageDexUser>[];
};

type ResolvedIdpOption = {
  readonly path: string;
  readonly upstream: string;
  readonly issuer?: string;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly jwksEndpoint?: string;
} & (
  | {
      readonly kind: 'dex';
      readonly dex: ResolvedDexConfig;
    }
  | { readonly kind: 'external' }
);

type ResolvedIdp = {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksEndpoint: string;
  readonly upstream: string;
} & (
  | {
      readonly kind: 'dex';
      readonly dex: ResolvedDexConfig;
    }
  | { readonly kind: 'external' }
);

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
  readonly services?: Record<string, VisageService>;
  readonly upstreams?: Record<string, VisageUpstream>;
};

export type VisageConfig = {
  readonly host: string;
  readonly port: number;
  readonly cookie: ResolvedCookiePolicy;
  readonly idp: ResolvedIdp;
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

  readonly services: Readonly<Record<string, VisageService>>;
  readonly upstreams: Readonly<Record<string, VisageUpstream>>;
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

const BaseServices = {
  dex: {
    image: 'ghcr.io/dexidp/dex:v2.45.1',
    command: ['dex', 'serve', '/etc/dex/dex.yml'],
  },
  nginx: {
    image: 'nginx:1.30.0-alpine',
    depends_on: ['oauth2_proxy', 'dex'],
    extra_hosts: ['host.docker.internal:host-gateway'],
  },
  oauth2_proxy: {
    image: 'quay.io/oauth2-proxy/oauth2-proxy:v7.15.2',
    command: ['--config', '/etc/oauth2-proxy/config.yml'],
    depends_on: ['dex'],
    extra_hosts: ['host.docker.internal:host-gateway'],
  },
} as const satisfies VisageConfig['services'];

const BaseDexUpstream = {
  host: 'dex',
  port: 5556,
  locations: { '/dex/': { auth: { enabled: false } } },
} as const satisfies VisageUpstream;

const BaseOauth2ProxyUpstream = {
  host: 'oauth2_proxy',
  port: 4180,
  locations: {
    '/oauth2/': {
      auth: { enabled: false },
      headers: {
        Cookie: '$http_cookie',
        Host: '$host',
        'X-Real-IP': '$remote_addr',
        'X-Forwarded-For': '$proxy_add_x_forwarded_for',
        'X-Forwarded-Proto': '$scheme',
        'X-Auth-Request-Redirect': '$request_uri',
      },
    },
  },
} as const satisfies VisageUpstream;

const BaseViteUpstream = {
  host: 'host.docker.internal',
  locations: {
    '/': {
      auth: { forward: false, redirect: true },
      headers: {
        Upgrade: '$http_upgrade',
        Connection: '$connection_upgrade',
      },
    },
  },
} as const satisfies Omit<VisageUpstream, 'port'>;

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

const DefaultIdpConfig = {
  kind: 'dex',
  path: '/dex',
  upstream: 'dex',
} as const satisfies Omit<
  ResolvedIdpOption,
  'issuer' | 'authorizationEndpoint' | 'jwksEndpoint' | 'tokenEndpoint'
>;

const DefaultOAuth2Client = {
  id: 'visage',
  secret: 'visage-secret',
  scopes: ['openid', 'email', 'profile'],
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
  const cookie = options.cookie ?? {};
  const cookieName = cookie.name ?? 'session';
  const oauth2 = options.oauth2 ?? {};
  const publicClient = oauth2.clientSecret === null;

  return {
    ...options,
    host: options.host ?? 'local.vite.app',
    port: options.port ?? 9001,
    cookie: {
      ...DefaultCookiePolicy,
      cookie_name:
        cookie.domains === undefined
          ? cookieName.startsWith('__HOST-')
            ? cookieName
            : `__HOST-${cookieName}`
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
  };
}

function resolveIdpOption(
  idp: VisageDexOptions | VisageIdpOptions | undefined,
): ResolvedIdpOption {
  function normalizePath(path: string): string {
    const pathWithLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    return pathWithLeadingSlash.endsWith('/')
      ? pathWithLeadingSlash.slice(0, -1)
      : pathWithLeadingSlash;
  }
  if (idp?.kind === 'external') {
    const { path = DefaultIdpConfig.path, ...external } = idp;
    return { ...external, path: normalizePath(path) };
  }
  return {
    ...DefaultIdpConfig,
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

export function resolveConfig(
  options: ResolvedVisageOptions,
  config: ResolvedConfig,
  vitePort: number,
): VisageConfig {
  const upstreams: Record<string, VisageUpstream> = {
    oauth2_proxy: BaseOauth2ProxyUpstream,
    vite: { ...BaseViteUpstream, port: vitePort },
    ...(options.idp.kind === 'dex' ? { dex: BaseDexUpstream } : {}),
    ...options.upstreams,
  };
  const { host: idpHost, port: idpPort } = upstreams[options.idp.upstream];
  const origin = `https://${options.host}:${options.port}`;
  const idpOrigin = `http://${idpHost}:${idpPort}`;
  const idpBase = {
    upstream: options.idp.upstream,
    issuer: options.idp.issuer ?? `${origin}${options.idp.path}`,
    authorizationEndpoint:
      options.idp.authorizationEndpoint ?? `${origin}${options.idp.path}/auth`,
    tokenEndpoint:
      options.idp.tokenEndpoint ?? `${idpOrigin}${options.idp.path}/token`,
    jwksEndpoint:
      options.idp.jwksEndpoint ?? `${idpOrigin}${options.idp.path}/keys`,
  };
  return {
    host: options.host,
    port: options.port,
    cookie: options.cookie,
    idp:
      options.idp.kind === 'dex'
        ? { ...idpBase, kind: 'dex', dex: options.idp.dex }
        : { ...idpBase, kind: 'external' },
    oauth2: options.oauth2,
    cache: join(config.cacheDir, 'visage'),
    files: { ...BaseFiles },
    services: {
      ...(options.idp.kind === 'dex'
        ? BaseServices
        : {
            nginx: {
              ...BaseServices.nginx,
              depends_on: ['oauth2_proxy'],
            },
            oauth2_proxy: {
              command: BaseServices.oauth2_proxy.command,
              image: BaseServices.oauth2_proxy.image,
            },
          }),
      ...options.services,
    },
    upstreams: Object.fromEntries(
      Object.entries(upstreams).map(([name, upstream]) => [
        name,
        {
          ...upstream,
          locations: Object.fromEntries(
            Object.entries(upstream.locations ?? {}).map(([path, policy]) => [
              path,
              {
                auth: { ...DefaultProxyPolicy.auth, ...policy.auth },
                headers: { ...DefaultProxyPolicy.headers, ...policy.headers },
              },
            ]),
          ),
        },
      ]),
    ),
  };
}
