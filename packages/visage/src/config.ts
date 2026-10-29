import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import type {
  VisageDexExpiry,
  VisageDexOptions,
  VisageDexSessions,
  VisageDexUser,
  VisageExternalIdpOptions,
  VisageOptions,
  VisageProxyPolicy,
  VisageService,
  VisageUpstream,
  VisageVolume,
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
  { readonly dex: VisageDexOptions } | VisageExternalIdpOptions;

type ResolvedOAuth2Client = {
  readonly id: string;
  readonly secret?: string;
  readonly scopes: readonly string[];
  readonly public: boolean;
  readonly postLogoutRedirectUri: string;
};

type ResolvedProxyPolicy = {
  readonly ws: boolean;
  readonly auth: {
    readonly enabled: boolean;
    readonly forward: false | 'id' | 'access';
  };
  readonly csrf: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly directives: Readonly<Record<string, readonly string[]>>;
};

type ResolvedTelemetry = {
  readonly fluentd?: string;
};

type ResolvedVisageOptions = {
  readonly host: string;
  readonly port: number;
  readonly telemetry: ResolvedTelemetry | false;
  readonly cookie: ResolvedCookiePolicy;
  readonly idp: ResolvedIdpOption;
  readonly oauth2: ResolvedOAuth2Client;
  readonly services: Readonly<Record<string, VisageService>>;
  readonly volumes: Readonly<Record<string, VisageVolume>>;
  readonly upstreams: Record<string, VisageUpstream>;
};

type ResolvedUpstream = {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly locations: Readonly<Record<string, ResolvedProxyPolicy>>;
  readonly http?: string;
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
    readonly sessions?: VisageDexSessions;
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

type ResolvedService = Omit<VisageService, 'upstream'>;

type ResolvedConfigUpstream = ResolvedUpstream & {
  readonly external: boolean;
};

export type VisageConfig = {
  readonly host: string;
  readonly port: number;
  readonly package: string;
  readonly telemetry: ResolvedTelemetry | false;
  readonly cookie: ResolvedCookiePolicy;
  readonly edgeKey: string;
  readonly idp: ResolvedIdpConfig;
  readonly oauth2: ResolvedOAuth2Client;

  readonly cache: string;
  readonly files: {
    readonly compose: string;
    readonly dex: Volume;
    readonly oauth2Proxy: Volume;
  };
  readonly secrets: {
    readonly cookieSecret: string;
    readonly clientSecret: string;
    readonly edgeKey: string;
  };
  readonly nginx: {
    readonly mount: Volume;
    readonly modules: readonly string[];
  };

  readonly services: Readonly<Record<string, ResolvedService>>;
  readonly volumes: Readonly<Record<string, VisageVolume>>;
  readonly upstreams: Readonly<Record<string, ResolvedConfigUpstream>>;
};

export const VisageEdgeKeyHeader = 'X-Visage-Edge-Key';

export const DockerImages = parse(
  readFileSync(
    new URL('../docker-compose.images.yml', import.meta.url),
    'utf8',
  ),
).services as Record<string, { image: string }>;

const BaseServiceDex = {
  image: DockerImages.dex.image,
  command: ['dex', 'serve', '/etc/dex/dex.yaml'],
  environment: { DEX_SESSIONS_ENABLED: 'true' },
  network_mode: 'service:nginx',
  restart: 'always',
} as const satisfies ResolvedService;

const BaseServiceNginx = {
  image: DockerImages.nginx.image,
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'always',
} as const satisfies ResolvedService;

const BaseServiceOAuth2Proxy = {
  image: DockerImages.oauth2_proxy.image,
  command: ['--config', '/etc/oauth2-proxy/config.yml'],
  network_mode: 'service:nginx',
  restart: 'always',
} as const satisfies ResolvedService;

const OTelCollectorConfig = fileURLToPath(
  new URL('../otelcol', import.meta.url),
);

const BaseServiceOTelCollector = {
  image: DockerImages.otelcol.image,
  environment: {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'host.docker.internal:4317',
  },
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'always',
  volumes: [`${OTelCollectorConfig}:/etc/otelcol-contrib:ro`],
  upstream: {
    port: 4318,
    locations: {
      '/t/': {
        auth: { enabled: true },
        directives: { rewrite: '^/t/(.*)$ /$1 break' },
      },
    },
  },
} as const satisfies VisageService;

const DefaultProxyPolicy = {
  ws: false,
  auth: { enabled: true, forward: false },
  csrf: true,
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
    proxy_connect_timeout: ['5s'],
    proxy_read_timeout: ['5s'],
    proxy_send_timeout: ['5s'],
  },
} as const satisfies ResolvedProxyPolicy;

const BaseUpstreamOauth2Proxy = {
  host: '127.0.0.1',
  scheme: 'http',
  port: 4180,
  locations: {
    '/oauth2/': {
      ws: false,
      auth: { enabled: false, forward: false },
      csrf: false,
      headers: {
        ...DefaultProxyPolicy.headers,
        Cookie: '$http_cookie',
        'X-Auth-Request-Redirect': '$request_uri',
      },
      directives: { ...DefaultProxyPolicy.directives },
    } satisfies ResolvedProxyPolicy,
    '= /oauth2/auth': {
      ws: false,
      auth: { enabled: false, forward: false },
      csrf: false,
      headers: {
        ...DefaultProxyPolicy.headers,
        Cookie: '$app_cookie',
        'Content-Length': '""',
      },
      directives: {
        ...DefaultProxyPolicy.directives,
        internal: [''],
        proxy_pass_request_body: ['off'],
      },
    } satisfies ResolvedProxyPolicy,
    '= /oauth2/userinfo': {
      ws: false,
      auth: { enabled: false, forward: false },
      csrf: false,
      headers: {},
      directives: { return: ['404'] },
    } satisfies ResolvedProxyPolicy,
    '/oauth2/sign_out': {
      ws: false,
      auth: { enabled: true, forward: false },
      csrf: false,
      headers: {
        ...DefaultProxyPolicy.headers,
        Cookie: '$next_app_cookie',
        'X-Auth-Request-Redirect': '/',
      },
      directives: { ...DefaultProxyPolicy.directives },
    } satisfies ResolvedProxyPolicy,
  },
} as const satisfies ResolvedUpstream;

const DefaultCookiePolicy = {
  cookie_expire: '720h',
  cookie_refresh: '30s',
  cookie_path: '/',
} as const satisfies Omit<ResolvedCookiePolicy, 'cookie_name'>;

const DefaultDexExpiry = {
  idTokens: '1m',
  refreshTokens: {
    reuseInterval: '1s',
    validIfNotUsedFor: '720h',
    absoluteLifetime: '720h',
  },
} as const satisfies VisageDexExpiry;

const DefaultDexSessions = {
  absoluteLifetime: '720h',
  validIfNotUsedFor: '720h',
} as const satisfies VisageDexSessions;

const DefaultDexUsers: readonly VisageDexUser[] = [
  { email: 'user@example.com', password: 'visage-password' },
];

export function resolveOptions(options: VisageOptions): ResolvedVisageOptions {
  const {
    host = 'localhost',
    port = 9001,
    cookie = {},
    idp = {},
    oauth2 = {},
  } = options;
  const cookieName = cookie.name ?? 'sess';
  const telemetry = options.telemetry === true ? {} : options.telemetry;
  return {
    host,
    port,
    telemetry: telemetry
      ? { fluentd: telemetry.fluentd ?? '127.0.0.1:24224' }
      : false,
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
              expiry: {
                ...DefaultDexExpiry,
                ...idp.expiry,
                refreshTokens: {
                  ...DefaultDexExpiry.refreshTokens,
                  ...idp.expiry?.refreshTokens,
                },
              },
              sessions: { ...DefaultDexSessions, ...idp.sessions },
              users: (idp.users ?? DefaultDexUsers).map((user) => ({
                email: user.email,
                password: user.password,
                username: user.username ?? user.email.split('@', 1)[0],
                userID: user.userID ?? user.email,
              })),
            },
          } satisfies ResolvedIdpOption),
    oauth2: {
      id: oauth2.clientId ?? 'visage',
      ...(oauth2.clientSecret === null
        ? {}
        : { secret: oauth2.clientSecret ?? 'visage-secret' }),
      scopes: oauth2.scopes ?? (['openid', 'offline_access'] as const),
      public: oauth2.clientSecret === null,
      postLogoutRedirectUri:
        `https://${host}:${port}` +
        ('issuer' in idp ? '/' : '/oauth2/start?rd=/'),
    } satisfies ResolvedOAuth2Client,
    services: options.services ?? {},
    volumes: options.volumes ?? {},
    upstreams: options.upstreams ?? {},
  } satisfies ResolvedVisageOptions;
}

function resolveServicesConfig({
  services,
  telemetry,
  idp,
  upstreams,
}: ResolvedVisageOptions): Record<string, VisageService> {
  const vite = upstreams.vite;
  const vitePort = vite?.port ?? (vite?.scheme === 'https' ? 443 : 80);
  return {
    ...services,
    ...('dex' in idp
      ? {
          dex: {
            ...BaseServiceDex,
            ...services.dex,
            environment: {
              ...BaseServiceDex.environment,
              ...services.dex?.environment,
            },
          },
        }
      : {}),
    ...(vite
      ? {
          vite_loopback: {
            image: DockerImages.socat.image,
            command:
              `tcp-listen:${vitePort},fork,bind=host.docker.internal ` +
              `tcp-connect:127.0.0.1:${vitePort}`,
            extra_hosts: ['host.docker.internal:host-gateway'],
            network_mode: 'host',
            profiles: ['linux'],
            restart: 'always',
            ...services.vite_loopback,
          },
        }
      : {}),
    nginx: {
      ...BaseServiceNginx,
      ...(services.nginx ?? {}),
      extra_hosts: [
        ...BaseServiceNginx.extra_hosts,
        ...(services.nginx?.extra_hosts ?? []),
      ],
    },
    oauth2_proxy: {
      ...BaseServiceOAuth2Proxy,
      ...(services.oauth2_proxy ?? {}),
    },
    ...(telemetry
      ? {
          otelcol: {
            ...BaseServiceOTelCollector,
            ports:
              telemetry.fluentd === undefined
                ? []
                : [`${telemetry.fluentd}:24224`],
            ...(services.otelcol ?? {}),
            environment: {
              ...BaseServiceOTelCollector.environment,
              ...(services.otelcol?.environment ?? {}),
            },
          },
        }
      : {}),
  };
}

function resolveUpstreamsConfig(
  services: Record<string, VisageService>,
  upstreams: Record<string, VisageUpstream> = {},
): Record<string, ResolvedUpstream> {
  return {
    ...Object.fromEntries(
      Object.entries(services)
        .filter(
          ([name]) =>
            // Exclude base services handled separately.
            name !== 'dex' &&
            name !== 'nginx' &&
            name !== 'oauth2_proxy' &&
            name !== 'vite_loopback',
        )
        .map(([name, service]) => [
          name,
          resolveUpstreamConfig(name, service.upstream, false),
        ]),
    ),
    ...Object.fromEntries(
      Object.entries(upstreams).map(([name, upstream]) => [
        name,
        name === 'vite'
          ? resolveViteUpstreamConfig(upstream)
          : resolveUpstreamConfig(name, upstream, services[name] === undefined),
      ]),
    ),
  };
}

const BaseViteUpstreamRootLocation: VisageProxyPolicy = {
  auth: { enabled: true, forward: false },
  csrf: true,
  ws: true,
  headers: {
    Host: '$host',
    'X-Auth-Request-User': '$auth_user',
    'X-Auth-Request-Email': '$auth_email',
    [VisageEdgeKeyHeader]: '$edge_key',
  },
};

function resolveViteUpstreamConfig(upstream: VisageUpstream): ResolvedUpstream {
  const base = BaseViteUpstreamRootLocation;
  const root = upstream.locations?.['/'];
  return resolveUpstreamConfig(
    'vite',
    {
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
                ws: root.ws ?? base.ws,
                headers: {
                  ...root.headers,
                  ...base.headers,
                },
                directives: {
                  ...base.directives,
                  ...root.directives,
                },
              },
      },
    },
    true,
  );
}

function resolveUpstreamConfig(
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
            resolveUpstreamLocationConfig(
              name,
              host,
              {
                ...policy,
                headers: { ...(upstream.headers ?? {}), ...policy.headers },
              },
              external,
            ),
          ],
        ),
      ),
    } satisfies Record<string, ResolvedProxyPolicy>,
  };
}

function resolveUpstreamLocationConfig(
  name: string,
  host: string,
  location: VisageProxyPolicy,
  external: boolean,
): ResolvedProxyPolicy {
  const auth = resolveAuthPolicy(location.auth, external && name !== 'vite');
  const { ws = false } = location;
  return {
    ...DefaultProxyPolicy,
    ...location,
    ws,
    auth,
    csrf: location.csrf ?? auth.enabled,
    headers: {
      ...DefaultProxyPolicy.headers,
      ...(external ? { Host: host } : {}),
      ...(auth.enabled && auth.forward === 'id'
        ? { Authorization: '$authorization' }
        : {}),
      ...(auth.enabled && auth.forward === 'access'
        ? { Authorization: '"Bearer $access_token"' }
        : {}),
      ...(ws
        ? {
            Connection: '$connection_upgrade',
            Upgrade: '$http_upgrade',
          }
        : {}),
      ...(location.headers ?? {}),
    } satisfies ResolvedProxyPolicy['headers'],
    directives: {
      ...DefaultProxyPolicy.directives,
      ...(ws
        ? {
            proxy_http_version: ['1.1'],
            proxy_read_timeout: ['1h'],
          }
        : {}),
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
  } satisfies ResolvedProxyPolicy['auth'];
}

export function resolveConfig(
  options: ResolvedVisageOptions & {
    readonly root: string;
    readonly cache: string;
    readonly edgeKey: string;
  },
): VisageConfig {
  const packageName = resolvePackage(options.root);
  const idp = resolveIdpConfig(options);
  const services = resolveServicesConfig(options);
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
                      encodeURIComponent(options.oauth2.postLogoutRedirectUri),
                  ),
                },
              } satisfies ResolvedProxyPolicy,
            },
          },
        }),
    ...idp.upstream,
    ...resolveUpstreamsConfig(services, options.upstreams),
  };
  return {
    host: options.host,
    port: options.port,
    package: packageName,
    telemetry: options.telemetry,
    cookie: options.cookie,
    edgeKey: options.edgeKey,
    idp,
    oauth2: options.oauth2,
    cache: options.cache,
    volumes: options.volumes,
    files: {
      compose: './compose.yaml',
      dex: ['./dex.yaml', '/etc/dex/dex.yaml'],
      oauth2Proxy: ['./oauth2-proxy.yml', '/etc/oauth2-proxy/config.yml'],
    },
    secrets: {
      cookieSecret: 'OAUTH2_PROXY_COOKIE_SECRET',
      clientSecret: 'OAUTH2_CLIENT_SECRET',
      edgeKey: 'VISAGE_EDGE_KEY',
    },
    nginx: {
      mount: ['./nginx', '/etc/nginx'],
      modules: [
        '/usr/lib/nginx/modules/ngx_http_js_module.so',
        ...(options.telemetry
          ? ['/usr/lib/nginx/modules/ngx_otel_module.so']
          : []),
      ],
    },
    services: Object.fromEntries(
      Object.entries(services).map(
        ([name, { upstream: _upstream, ...service }]) => [
          name,
          {
            restart: 'on-failure',
            ...(options.telemetry && options.telemetry.fluentd !== undefined
              ? {
                  logging: {
                    driver: 'fluentd',
                    options: {
                      'fluentd-address': options.telemetry.fluentd,
                      'fluentd-async': 'true',
                      'cache-disabled': 'true',
                      tag: `${packageName}/${name}|{{.ImageName}}`,
                    },
                  },
                }
              : {}),
            ...service,
          },
        ],
      ),
    ),
    upstreams: Object.fromEntries(
      Object.entries(upstreams).map(([name, upstream]) => {
        const external =
          options.upstreams[name] !== undefined && services[name] === undefined;
        return [
          name,
          { ...upstream, external } satisfies ResolvedConfigUpstream,
        ];
      }),
    ),
  };
}

function resolvePackage(root: string): string {
  try {
    return JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ).name.trim();
  } catch {
    return basename(resolve(root));
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
        sessions: idp.dex.sessions,
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
        token: 'http://127.0.0.1:5556/dex/token',
        jwks: 'http://127.0.0.1:5556/dex/keys',
        end_session_endpoint: `https://${host}:${port}/dex/logout`,
      },
      upstream: {
        dex: {
          host: '127.0.0.1',
          scheme: 'http',
          port: 5556,
          http: `
            map "$request_method:$uri" $dex_password_limit_key {
                default "";
                ~^POST:/dex/auth/[^/]+/login$ $binary_remote_addr;
            }
            limit_req_zone $dex_password_limit_key zone=dex_password:1m rate=1r/s;
          `,
          locations: {
            '/dex/': {
              ws: false,
              auth: { enabled: false, forward: false },
              csrf: false,
              headers: {
                ...DefaultProxyPolicy.headers,
                Cookie: 'dex_session=$cookie_dex_session',
              },
              directives: {
                ...DefaultProxyPolicy.directives,
                limit_req: ['zone=dex_password burst=5 nodelay'],
                limit_req_status: ['429'],
              },
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
