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

type OIDCEndpoint = {
  readonly issuer: string;
  readonly authorization?: string;
  readonly token?: string;
  readonly jwks?: string;
  readonly algs?: readonly string[];
  readonly end_session_endpoint?: string;
};

type ManualOIDCEndpoint = OIDCEndpoint & {
  readonly authorization: string;
  readonly token: string;
  readonly jwks: string;
};

type ResolvedDexIdp = {
  readonly dex: {
    readonly expiry: VisageDexExpiry;
    readonly sessions: VisageDexSessions;
    readonly users: readonly VisageDexUser[];
  };
  readonly oidc: ManualOIDCEndpoint;
};
type ResolvedExternalIdp = { readonly oidc: OIDCEndpoint };
type ResolvedIdp = ResolvedDexIdp | ResolvedExternalIdp;

type ResolvedOAuth2Client = {
  readonly id: string;
  readonly secret?: string;
  readonly scopes: readonly string[];
  readonly public: boolean;
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
};

type ResolvedVisageOptions = {
  readonly host: string;
  readonly port: number;
  readonly telemetry: { readonly fluentd?: string } | false;
  readonly cookie: ResolvedCookiePolicy;
  readonly idp: ResolvedIdp;
  readonly oauth2: ResolvedOAuth2Client;
  readonly services: Readonly<Record<string, VisageService>>;
  readonly volumes: Readonly<Record<string, VisageVolume>>;
  readonly remotes: Record<string, VisageUpstream>;
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

type ResolvedUpstream = {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly locations: Readonly<Record<string, ResolvedProxyPolicy>>;
  readonly http?: string;
};

type ResolvedService = VisageService & { readonly upstream?: ResolvedUpstream };

export type VisageConfig = {
  readonly package: string;
  readonly telemetry: boolean;
  readonly edgeKey: string;
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

  readonly app: {
    readonly host: string;
    readonly port: number;
    readonly client: ResolvedOAuth2Client;
    readonly cookie: ResolvedCookiePolicy;
    readonly upstream: ResolvedUpstream;
  };
  readonly idp: ResolvedIdp;
  readonly services: Readonly<Record<string, ResolvedService>>;
  readonly volumes: Readonly<Record<string, VisageVolume>>;
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
  image: DockerImages.dex.image,
  command: ['dex', 'serve', '/etc/dex/dex.yaml'],
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
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'always',
  upstream: false,
} as const satisfies VisageService;

const BaseServiceOAuth2Proxy = {
  image: DockerImages.oauth2_proxy.image,
  command: ['--config', '/etc/oauth2-proxy/config.yml'],
  network_mode: 'service:nginx',
  restart: 'always',
  upstream: {
    host: '127.0.0.1',
    scheme: 'http',
    port: 4180,
    locations: {
      '/oauth2/': {
        ws: false,
        auth: { enabled: false, forward: false },
        csrf: false,
        headers: {
          Cookie: '$http_cookie',
          'X-Auth-Request-Redirect': '$request_uri',
        },
      } satisfies VisageProxyPolicy,
      '= /oauth2/auth': {
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
      '= /oauth2/userinfo': {
        ws: false,
        auth: { enabled: false, forward: false },
        csrf: false,
        headers: {},
        directives: { return: ['404'] },
      } satisfies VisageProxyPolicy,
      '/oauth2/sign_out': {
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
  volumes: [
    `${fileURLToPath(new URL('../otelcol', import.meta.url))}:/etc/otelcol-contrib:ro`,
  ],
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

export function resolveOptions(options: VisageOptions): ResolvedVisageOptions {
  const { host = 'localhost', port = 9001, cookie = {}, oauth2 = {} } = options;
  const cookieName = cookie.name ?? 'sess';
  const telemetry = options.telemetry === true ? {} : options.telemetry;
  const idp = resolveIdpOptions({ host, port, idp: options.idp });
  const issuer = new URL(idp.oidc.issuer);
  return {
    host,
    port,
    telemetry: telemetry
      ? { fluentd: telemetry.fluentd ?? '127.0.0.1:24224' }
      : false,
    cookie: {
      cookie_expire: '720h',
      cookie_refresh: '30s',
      cookie_path: '/',
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
    idp,
    oauth2: {
      id: oauth2.clientId ?? 'visage',
      ...(oauth2.clientSecret === null
        ? {}
        : { secret: oauth2.clientSecret ?? 'visage-secret' }),
      scopes: oauth2.scopes ?? (['openid', 'offline_access'] as const),
      public: oauth2.clientSecret === null,
      redirectUri: `https://${host}:${port}/oauth2/callback`,
      postLogoutRedirectUri:
        `https://${host}:${port}` +
        (options.idp !== undefined && 'issuer' in options.idp
          ? '/'
          : '/oauth2/start?rd=/'),
    } satisfies ResolvedOAuth2Client,
    services: options.services ?? {},
    volumes: options.volumes ?? {},
    remotes: {
      ...('dex' in idp
        ? {}
        : {
            idp: {
              scheme: issuer.protocol === 'https:' ? 'https' : 'http',
              host: issuer.hostname,
              port:
                Number(issuer.port) ||
                (issuer.protocol === 'https:' ? 443 : 80),
              locations: {},
            },
          }),
      ...options.remotes,
    },
  } satisfies ResolvedVisageOptions;
}

function resolveIdpOptions({
  host,
  port,
  idp = {},
}: {
  readonly host: string;
  readonly port: number;
  readonly idp?: VisageDexOptions | VisageExternalIdpOptions;
}): ResolvedIdp {
  if (!('issuer' in idp)) {
    return {
      dex: {
        expiry: {
          idTokens: '1m',
          ...idp.expiry,
          refreshTokens: {
            reuseInterval: '1s',
            validIfNotUsedFor: '720h',
            absoluteLifetime: '720h',
            ...idp.expiry?.refreshTokens,
          },
        },
        sessions: {
          absoluteLifetime: '720h',
          validIfNotUsedFor: '720h',
          ...idp.sessions,
        },
        users: (
          idp.users ?? [
            { email: 'user@example.com', password: 'visage-password' },
          ]
        ).map((user) => ({
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
    } satisfies ResolvedDexIdp;
  }
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
  } satisfies ResolvedExternalIdp;
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
  const services = resolveServicesConfig(options, options.appPort);
  if (Object.hasOwn(services, 'app') || Object.hasOwn(options.remotes, 'app')) {
    throw new Error('Upstream name "app" is reserved for the application');
  }
  for (const name of Object.keys(options.remotes)) {
    if (Object.hasOwn(services, name)) {
      throw new Error('Remote and service names must be distinct');
    }
  }
  return {
    package: packageName,
    telemetry: Boolean(options.telemetry),
    edgeKey: options.edgeKey,
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
    app: {
      host: options.host,
      port: options.port,
      client: options.oauth2,
      cookie: options.cookie,
      upstream: resolveUpstreamConfig(
        'app',
        { ...BaseAppUpstream, port: options.appPort },
        false,
      ),
    },
    idp: options.idp,
    services: Object.fromEntries(
      Object.entries(services).map(([name, { upstream, ...service }]) => [
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
          ...(upstream === false
            ? {}
            : { upstream: resolveUpstreamConfig(name, upstream ?? {}, false) }),
        },
      ]),
    ),
    remotes: Object.fromEntries(
      Object.entries(options.remotes).map(([name, upstream]) => [
        name,
        resolveUpstreamConfig(name, upstream, true),
      ]),
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

function resolveServicesConfig(
  { services, telemetry, oauth2, idp }: ResolvedVisageOptions,
  appPort: number,
): Record<string, VisageService> {
  const end_session_endpoint = idp.oidc.end_session_endpoint;
  return {
    ...services,
    ...('dex' in idp
      ? {
          dex: {
            ...BaseServiceDex,
            ...services.dex,
            upstream:
              services.dex?.upstream === false
                ? false
                : { ...BaseServiceDex.upstream, ...services.dex?.upstream },
            environment: {
              ...BaseServiceDex.environment,
              ...services.dex?.environment,
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
      ...services.oauth2_proxy,
      upstream: services.oauth2_proxy?.upstream || {
        ...BaseServiceOAuth2Proxy.upstream,
        locations: {
          ...BaseServiceOAuth2Proxy.upstream.locations,
          '/oauth2/sign_out': {
            ...BaseServiceOAuth2Proxy.upstream.locations['/oauth2/sign_out'],
            headers: {
              ...BaseServiceOAuth2Proxy.upstream.locations['/oauth2/sign_out']
                .headers,
              'X-Auth-Request-Redirect':
                end_session_endpoint === undefined
                  ? '/'
                  : JSON.stringify(
                      end_session_endpoint +
                        (end_session_endpoint.includes('?') ? '&' : '?') +
                        'id_token_hint={id_token}&post_logout_redirect_uri=' +
                        encodeURIComponent(oauth2.postLogoutRedirectUri),
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
  };
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
