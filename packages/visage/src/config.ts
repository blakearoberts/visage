import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import type {
  VisageDexExpiry,
  VisageDexSessions,
  VisageDexUser,
  VisageExternalIdpOptions,
  VisageOptions,
  VisageProxyPolicy,
  VisageService,
  VisageUpstream,
} from './types';

type ResolvedCookiePolicy = {
  readonly cookie_name: string;
  readonly cookie_expire: string;
  readonly cookie_refresh: string;
  readonly cookie_domains?: readonly string[];
  readonly cookie_path: string;
};

type OIDCEndpoint = {
  readonly issuer: string;
  readonly authorization?: string;
  readonly token?: string;
  readonly jwks?: string;
  readonly algs?: readonly string[];
  readonly end_session_endpoint?: string;
};

type ResolvedOAuth2Client = {
  readonly id: string;
  readonly secret: string;
  readonly scopes: readonly string[];
  readonly public: boolean;
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
};

type ResolvedDexConfig = {
  readonly issuer: string;
  readonly storage: { readonly type: 'memory' };
  readonly web: { readonly http: string };
  readonly oauth2: { readonly skipApprovalScreen: true };
  readonly staticClients: readonly {
    readonly id: string;
    readonly name: string;
    readonly public?: true;
    readonly secret?: string;
    readonly refreshTokenLifetime: 'session';
    readonly postLogoutRedirectURIs: readonly string[];
    readonly redirectURIs: readonly string[];
  }[];
  readonly enablePasswordDB: true;
  readonly expiry: VisageDexExpiry;
  readonly sessions: VisageDexSessions;
  readonly users: readonly Required<VisageDexUser>[];
};

type ResolvedVisageOptions = ReturnType<typeof resolveOptions>;

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

type ResolvedUpstream = {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly locations: Readonly<Record<string, ResolvedProxyPolicy>>;
  readonly http?: string;
};

type ResolvedService = Omit<VisageService, 'mounts'> & {
  readonly volumes: readonly {
    readonly type: 'bind' | 'volume' | 'tmpfs';
    readonly target: string;
    readonly source?: string;
    readonly read_only?: boolean;
    readonly tmpfs?: { readonly mode?: number };
  }[];
  readonly upstream?: ResolvedUpstream;
  readonly client?: ResolvedOAuth2Client;
};

export type VisageConfig = {
  readonly hosts: string[];
  readonly package: string;
  readonly telemetry: boolean;
  readonly edgeKey: string;
  readonly cache: string;
  readonly files: {
    readonly compose: string;
    readonly dex: string;
    readonly oauth2Proxy: string;
    readonly nginx: string;
  };

  readonly app: {
    readonly host: string;
    readonly port: number;
    readonly client: ResolvedOAuth2Client;
    readonly cookie: ResolvedCookiePolicy;
    readonly upstream: ResolvedUpstream;
  };
  readonly oidc: OIDCEndpoint;
  readonly dex?: ResolvedDexConfig;
  readonly services: Readonly<Record<string, ResolvedService>>;
  readonly remotes: Readonly<Record<string, ResolvedUpstream>>;
};

export const VisageEdgeKeyHeader = 'X-Visage-Edge-Key';

export const DockerImages = parse(
  readFileSync(
    new URL('../docker-compose.images.yml', import.meta.url),
    'utf8',
  ),
).services as Record<string, { image: string }>;

const BaseAppUpstream = {
  host: 'host.docker.internal',
  scheme: 'http',
  headers: { [VisageEdgeKeyHeader]: '$edge_key' },
  locations: {
    '/': {
      ws: true,
      auth: { enabled: true, forward: false },
      csrf: true,
      headers: {
        Host: '$host',
        'X-Auth-Request-User': '$auth_user',
        'X-Auth-Request-Email': '$auth_email',
      },
    },
  },
} as const satisfies VisageUpstream;

const BaseServiceDex = {
  secrets: ['VISAGE_OAUTH_CLIENT_SECRET'],
  image: DockerImages.dex.image,
  command: ['dex', 'serve', '/etc/dex/dex.yaml'],
  mounts: {
    '/etc/dex/dex.yaml': { bind: './dex.yaml', read_only: true },
  },
  environment: { DEX_SESSIONS_ENABLED: 'true' },
  network_mode: 'service:nginx',
  restart: 'always',
  upstream: {
    host: '127.0.0.1',
    scheme: 'http',
    port: 5556,
    auth: { enabled: false, forward: false },
    csrf: false,
    headers: { Cookie: 'dex_session=$cookie_dex_session' },
    directives: {
      limit_req: ['zone=dex_password burst=5 nodelay'],
      limit_req_status: ['429'],
    },
    http: `
      map "$request_method:$uri" $dex_password_limit_key {
          default "";
          ~^POST:/dex/auth/[^/]+/login$ $binary_remote_addr;
      }
      limit_req_zone $dex_password_limit_key zone=dex_password:1m rate=1r/s;`,
  },
} as const satisfies VisageService;

const BaseServiceNginx = {
  image: DockerImages.nginx.image,
  command: ['nginx', '-p', '/etc/nginx', '-g', 'daemon off;'],
  restart: 'always',
  upstream: false,
  user: `${process.getuid?.() ?? 101}:${process.getgid?.() ?? 101}`,
  environment: {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otelcol:4317',
    OTEL_SERVICE_NAME: 'nginx',
  },
  mounts: {
    '/etc/nginx': { bind: './nginx' },
    '/var/cache/nginx': { mode: 0o1777 },
    '/etc/nginx/http.d': { mode: 0o1777 },
  },
} as const satisfies VisageService;

const BaseServiceOAuth2Proxy = {
  secrets: ['OAUTH2_PROXY_COOKIE_SECRET', 'VISAGE_OAUTH_CLIENT_SECRET'],
  image: DockerImages.oauth2_proxy.image,
  command: ['--config', '/etc/oauth2-proxy/config.yml'],
  mounts: {
    '/etc/oauth2-proxy/config.yml': {
      bind: './oauth2-proxy.yml',
      read_only: true,
    },
  },
  network_mode: 'service:nginx',
  restart: 'always',
  upstream: {
    host: '127.0.0.1',
    scheme: 'http',
    port: 4180,
    locations: {
      '/oauth/': {
        ws: false,
        auth: { enabled: false, forward: false },
        csrf: false,
        headers: {
          Cookie: '$http_cookie',
          'X-Auth-Request-Redirect': '$request_uri',
        },
      } satisfies VisageProxyPolicy,
      '= /oauth/auth': {
        ws: false,
        auth: { enabled: false, forward: false },
        csrf: false,
        headers: {
          Cookie: '$app_cookie',
          'Content-Length': '""',
        },
        directives: {
          internal: [''],
          proxy_pass_request_body: ['off'],
        },
      } satisfies VisageProxyPolicy,
      '= /oauth/userinfo': {
        ws: false,
        auth: { enabled: false, forward: false },
        csrf: false,
        headers: {},
        directives: { return: ['404'] },
      } satisfies VisageProxyPolicy,
      '/oauth/sign_out': {
        ws: false,
        auth: { enabled: true, forward: false },
        csrf: false,
        headers: {
          Cookie: '$next_app_cookie',
          'X-Auth-Request-Redirect': '/',
        },
      } satisfies VisageProxyPolicy,
    },
  },
} as const satisfies VisageService;

const BaseServiceOTelCollector = {
  image: DockerImages.otelcol.image,
  environment: {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'host.docker.internal:4317',
  },
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'always',
  mounts: {
    '/etc/otelcol-contrib': {
      bind: fileURLToPath(new URL('../otelcol', import.meta.url)),
      read_only: true,
    },
  },
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

export function resolveOptions(options: VisageOptions) {
  const {
    host = 'localhost',
    port = 9001,
    cookie = {},
    client = {},
    idp = {},
  } = options;
  const cookieName = cookie.name ?? 'sess';
  const cookiePath = cookie.path ?? '/';
  const telemetry = options.telemetry === true ? {} : options.telemetry;
  const oidc = resolveOidcOptions(
    `https://${options.services?.dex?.host ?? host}:${port}`,
    'issuer' in idp ? idp : undefined,
  );
  const issuer = new URL(oidc.issuer);
  return {
    host,
    port,
    telemetry: telemetry
      ? { fluentd: telemetry.fluentd ?? '127.0.0.1:24224' }
      : (false as const),
    cookie: {
      cookie_expire: '720h',
      cookie_refresh: '30s',
      cookie_path: cookiePath,
      cookie_name:
        !cookie.domains?.length && cookiePath === '/'
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
    } satisfies ResolvedCookiePolicy,
    oidc,
    dex: 'issuer' in idp ? undefined : idp,
    client: {
      id: 'visage',
      secret: randomBytes(32).toString('base64url'),
      scopes: ['openid', 'offline_access'],
      public: false,
      redirectUri: `https://${host}:${port}/oauth/callback`,
      postLogoutRedirectUri:
        `https://${host}:${port}` +
        ('issuer' in idp ? '/' : '/oauth/start?rd=/'),
      ...client,
    } satisfies ResolvedOAuth2Client,
    services: Object.fromEntries(
      Object.entries(options.services ?? {}).map(
        ([name, { client, ...service }]) =>
          [
            name,
            {
              ...service,
              ...(client === undefined
                ? {}
                : {
                    client: {
                      id: name,
                      secret: randomBytes(32).toString('base64url'),
                      scopes: ['openid', 'offline_access'],
                      public: false,
                      redirectUri: `https://${service.host ?? host}:${port}/oauth/callback`,
                      postLogoutRedirectUri: `https://${service.host ?? host}:${port}/`,
                      ...client,
                    },
                  }),
            },
          ] as const,
      ),
    ),
    remotes: {
      ...('issuer' in idp
        ? {
            idp: {
              scheme: issuer.protocol === 'https:' ? 'https' : 'http',
              host: issuer.hostname,
              port: Number(issuer.port) || undefined,
              locations: {},
            },
          }
        : {}),
      ...options.remotes,
    } as Record<string, VisageUpstream>,
  };
}

function resolveOidcOptions(
  origin: string,
  idp?: VisageExternalIdpOptions,
): OIDCEndpoint {
  if (idp === undefined) {
    const { host, port } = BaseServiceDex.upstream;
    return {
      issuer: `${origin}/dex`,
      authorization: `${origin}/dex/auth`,
      token: `http://${host}:${port}/dex/token`,
      jwks: `http://${host}:${port}/dex/keys`,
      end_session_endpoint: `${origin}/dex/logout`,
    };
  }
  const { issuer, algs, end_session_endpoint, authorization, token, jwks } =
    idp;
  return {
    issuer,
    ...(algs === undefined ? {} : { algs }),
    ...(end_session_endpoint === undefined ? {} : { end_session_endpoint }),
    ...(!authorization && !token && !jwks
      ? {}
      : {
          authorization: issuer + (authorization ?? '/auth'),
          token: issuer + (token ?? '/token'),
          jwks: issuer + (jwks ?? '/keys'),
        }),
  };
}

export function resolveConfig(
  options: ResolvedVisageOptions & {
    readonly root: string;
    readonly cache: string;
    readonly edgeKey: string;
    readonly appPort: number;
  },
): VisageConfig {
  const packageName = resolvePackage(options.root);
  const services = resolveServicesConfig(packageName, options.appPort, options);
  for (const name of Object.keys(options.remotes)) {
    if (Object.hasOwn(services, name)) {
      throw new Error('Remote and service names must be distinct');
    }
  }

  return {
    hosts: [
      ...new Set([
        options.host,
        ...Object.values(services)
          .map((service) => service.host)
          .filter((host) => host !== undefined),
      ]),
    ],
    package: packageName,
    telemetry: Boolean(options.telemetry),
    edgeKey: options.edgeKey,
    cache: options.cache,
    files: {
      compose: './compose.yaml',
      dex: BaseServiceDex.mounts[BaseServiceDex.command[2]].bind,
      oauth2Proxy:
        BaseServiceOAuth2Proxy.mounts[BaseServiceOAuth2Proxy.command[1]].bind,
      nginx: BaseServiceNginx.mounts[BaseServiceNginx.command[2]].bind,
    },
    app: {
      host: options.host,
      port: options.port,
      client: options.client,
      cookie: options.cookie,
      upstream: resolveUpstreamConfig(
        'app',
        { ...BaseAppUpstream, port: options.appPort },
        false,
      ),
    },
    oidc: options.oidc,
    dex: resolveDexConfig(options, services),
    services,
    remotes: Object.fromEntries(
      Object.entries(options.remotes).map(([name, upstream]) => [
        name,
        resolveUpstreamConfig(name, upstream, true),
      ]),
    ),
  };
}

function resolveDexConfig(
  { dex, oidc, client }: ResolvedVisageOptions,
  services: VisageConfig['services'],
): ResolvedDexConfig | undefined {
  if (dex === undefined) return undefined;
  return {
    issuer: oidc.issuer,
    storage: { type: 'memory' },
    web: {
      http: `${BaseServiceDex.upstream.host}:${BaseServiceDex.upstream.port}`,
    },
    oauth2: { skipApprovalScreen: true },
    staticClients: [
      ['VISAGE_OAUTH_CLIENT_SECRET', client] as const,
      ...Object.entries(services).map(
        ([name, { client }]) =>
          [`VISAGE_${name}_CLIENT_SECRET`, client] as const,
      ),
    ].flatMap(([secret, client]) =>
      client
        ? [
            {
              id: client.id,
              name: client.id,
              ...(client.public
                ? { public: true }
                : { secret: `{{ file.Read "/run/secrets/${secret}" }}` }),
              refreshTokenLifetime: 'session',
              postLogoutRedirectURIs: [client.postLogoutRedirectUri],
              redirectURIs: [client.redirectUri],
            },
          ]
        : [],
    ),
    enablePasswordDB: true,
    expiry: {
      idTokens: '1m',
      ...dex.expiry,
      refreshTokens: {
        reuseInterval: '1s',
        validIfNotUsedFor: '720h',
        absoluteLifetime: '720h',
        ...dex.expiry?.refreshTokens,
      },
    },
    sessions: {
      absoluteLifetime: '720h',
      validIfNotUsedFor: '720h',
      ...dex.sessions,
    },
    users: (
      dex.users ?? [{ email: 'user@example.com', password: 'visage-password' }]
    ).map((user) => ({
      email: user.email,
      password: user.password,
      username: user.username ?? user.email.split('@', 1)[0],
      userID: user.userID ?? user.email,
    })),
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

function resolveServicesConfig(
  packageName: string,
  appPort: number,
  options: ResolvedVisageOptions,
): Record<string, ResolvedService> {
  const {
    services: { dex = {}, nginx = {}, oauth2_proxy = {}, ...services },
    telemetry,
    client,
  } = options;
  const { end_session_endpoint } = options.oidc;
  const serviceOptions: ResolvedVisageOptions['services'] = {
    ...services,
    ...(options.dex !== undefined
      ? {
          dex: {
            ...BaseServiceDex,
            ...dex,
            mounts: {
              ...BaseServiceDex.mounts,
              ...dex.mounts,
            },
            secrets: [
              ...BaseServiceDex.secrets,
              ...Object.entries(options.services).flatMap(
                ([name, { client }]) =>
                  client ? [`VISAGE_${name}_CLIENT_SECRET`] : [],
              ),
              ...(dex.secrets ?? []),
            ],
            upstream:
              dex.upstream === false
                ? false
                : { ...BaseServiceDex.upstream, ...dex.upstream },
            environment: { ...BaseServiceDex.environment, ...dex.environment },
          },
        }
      : {}),
    nginx: {
      ...BaseServiceNginx,
      ...nginx,
      ports: [`127.0.0.1:${options.port}:${options.port}`],
      environment: {
        ...BaseServiceNginx.environment,
        OTEL_SERVICE_NAMESPACE: packageName,
        ...nginx.environment,
      },
      mounts: {
        ...BaseServiceNginx.mounts,
        ...nginx.mounts,
      },
      secrets: ['VISAGE_EDGE_KEY', ...(nginx.secrets ?? [])],
      extra_hosts: [
        ...['host.docker.internal:host-gateway'],
        ...(nginx.extra_hosts ?? []),
      ],
    },
    oauth2_proxy: {
      ...BaseServiceOAuth2Proxy,
      ...oauth2_proxy,
      mounts: {
        ...BaseServiceOAuth2Proxy.mounts,
        ...oauth2_proxy.mounts,
      },
      secrets: [
        ...BaseServiceOAuth2Proxy.secrets,
        ...(oauth2_proxy.secrets ?? []),
      ],
      upstream: oauth2_proxy.upstream || {
        ...BaseServiceOAuth2Proxy.upstream,
        locations: {
          ...BaseServiceOAuth2Proxy.upstream.locations,
          '/oauth/sign_out': {
            ...BaseServiceOAuth2Proxy.upstream.locations['/oauth/sign_out'],
            headers: {
              ...BaseServiceOAuth2Proxy.upstream.locations['/oauth/sign_out']
                .headers,
              'X-Auth-Request-Redirect':
                end_session_endpoint === undefined
                  ? '/'
                  : JSON.stringify(
                      end_session_endpoint +
                        (end_session_endpoint.includes('?') ? '&' : '?') +
                        'id_token_hint={id_token}&post_logout_redirect_uri=' +
                        encodeURIComponent(client.postLogoutRedirectUri),
                    ),
            },
          } satisfies VisageProxyPolicy,
        },
      },
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
    vite_loopback: {
      image: DockerImages.socat.image,
      command:
        `tcp-listen:${appPort},fork,bind=host.docker.internal ` +
        `tcp-connect:127.0.0.1:${appPort}`,
      extra_hosts: ['host.docker.internal:host-gateway'],
      network_mode: 'host',
      profiles: ['linux'],
      restart: 'always',
      upstream: false,
      ...services.vite_loopback,
    },
  };
  return Object.fromEntries(
    Object.entries(serviceOptions).map(
      ([name, { upstream, networks, mounts, ...service }]) => [
        name,
        {
          restart: 'on-failure',
          security_opt: ['no-new-privileges:true'],
          cap_drop: ['ALL'],
          read_only: !service.secrets?.length,
          ...(telemetry && telemetry.fluentd !== undefined
            ? {
                logging: {
                  driver: 'fluentd',
                  options: {
                    'fluentd-address': telemetry.fluentd,
                    'fluentd-async': 'true',
                    'cache-disabled': 'true',
                    tag: `${packageName}/${name}|{{.ImageName}}`,
                  },
                },
              }
            : {}),
          ...service,
          volumes: Object.entries(mounts ?? {}).map(
            ([target, { read_only, ...mount }]) => ({
              target,
              read_only,
              ...('bind' in mount
                ? { type: 'bind' as const, source: mount.bind }
                : 'volume' in mount
                  ? { type: 'volume' as const, source: mount.volume }
                  : { type: 'tmpfs' as const, tmpfs: mount }),
            }),
          ),
          ...(service.network_mode === undefined
            ? { networks: [...new Set([name, ...(networks ?? [])])] }
            : {}),
          ...(upstream === false
            ? {}
            : { upstream: resolveUpstreamConfig(name, upstream ?? {}, false) }),
        } satisfies ResolvedService,
      ],
    ),
  );
}

function resolveUpstreamConfig(
  name: string,
  upstream: VisageUpstream,
  external: boolean,
): ResolvedUpstream {
  const scheme = upstream.scheme ?? (external ? 'https' : 'http');
  const host = upstream.host ?? name;
  return {
    ...upstream,
    scheme,
    host,
    port: upstream.port ?? (scheme === 'https' ? 443 : 80),
    locations: Object.fromEntries(
      Object.entries(upstream.locations ?? { [`/${name}/`]: {} }).map(
        ([path, policy]) => {
          const auth = { ...upstream.auth, ...policy.auth };
          return [
            path,
            resolveUpstreamLocationConfig({
              ...policy,
              ws: policy.ws ?? upstream.ws,
              csrf: policy.csrf ?? upstream.csrf,
              auth: {
                enabled: auth.enabled ?? true,
                forward:
                  auth.forward === true
                    ? external
                      ? 'access'
                      : 'id'
                    : (auth.forward ?? false),
              },
              headers: {
                ...(external ? { Host: host } : {}),
                ...upstream.headers,
                ...policy.headers,
              },
              directives: { ...upstream.directives, ...policy.directives },
            }),
          ];
        },
      ),
    ),
  };
}

function resolveUpstreamLocationConfig(
  location: VisageProxyPolicy & { readonly auth: ResolvedProxyPolicy['auth'] },
): ResolvedProxyPolicy {
  const { ws = false } = location;
  return {
    ...DefaultProxyPolicy,
    ...location,
    ws,
    csrf: location.csrf ?? location.auth.enabled,
    headers: {
      ...DefaultProxyPolicy.headers,
      ...(location.auth.enabled && location.auth.forward === 'id'
        ? { Authorization: '$authorization' }
        : {}),
      ...(location.auth.enabled && location.auth.forward === 'access'
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
