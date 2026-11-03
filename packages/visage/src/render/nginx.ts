import { mkdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';

import { Eta } from 'eta';

import type { VisageConfig } from '../config';

const template = `
load_module /usr/lib/nginx/modules/ngx_http_js_module.so;
<%_ if (it.telemetry) { %>
load_module /usr/lib/nginx/modules/ngx_otel_module.so;
<%_ } %>

pid /tmp/nginx.pid;

events {}

http {
    js_import edge_key from edge-key.js;
    js_shared_dict_zone zone=edge_key:32k;
    js_set $edge_key edge_key;

    map $http_cookie $app_cookie {
        default "";
        "~(?:^|;)[[:blank:]]*(<%~ it.cookie_name %>=[^;]*)" $1;
    }
    map $auth_set_cookie $next_app_cookie {
        default $app_cookie;
        "~^(<%~ it.cookie_name %>=[^;]*)" $1;
    }

    <%_ if (it.telemetry) { %>
    include http.d/otel.conf;
    <%_ } %>

    # Disable IPv6 DNS lookup. Docker Desktop (com.docker.backend), doesn't
    # support IPv6 traffic translation to host loopback.
    resolver 127.0.0.11 ipv6=off;

    # Configure access log format.
    log_format access_log_format escape=json
        '{"timestamp":"$time_iso8601","http.response.status_code":$status,'
        '"user.name":"$auth_user","http.request.method":"$request_method",'
        '"url.original":"$request_uri"}';

    # Allow WebSockets (Vite HMR).
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    # Fetch Metadata CSRF guard for cookie auth locations.
    map $request_method $csrf_method {
        default  unsafe;
        GET      safe;
        HEAD     safe;
        OPTIONS  safe;
    }
    map $http_origin $csrf_origin {
        default invalid;
        ''      absent;
        "<%~ it.origin %>" match;
    }
    map $http_referer $csrf_referer {
        default invalid;
        ''      absent;
        "<%~ it.referer %>" match;
    }
    map "$csrf_method:$csrf_origin:$csrf_referer" $csrf_fallback {
        default             deny;
        "~^safe:.*:.*$"     allow;
        unsafe:match:match  allow;
        unsafe:match:absent allow;
        unsafe:absent:match allow;
    }
    map "$request_method:$http_sec_fetch_mode:$http_sec_fetch_dest" $csrf_doc_nav {
        default               0;
        GET:navigate:document 1;
    }
    map "$http_sec_fetch_site:$csrf_doc_nav" $csrf_fetch_metadata {
        default                       fallback;
        "~^(same-origin|none):(0|1)$" allow;
        "~^(same-site|cross-site):1$" allow;
        "~^(same-site|cross-site):0$" deny;
    }
    map "$csrf_fetch_metadata:$csrf_fallback" $csrf_reject {
        default        1;
        allow:deny     0;
        allow:allow    0;
        fallback:allow 0;
    }
    map "$request_method:$http_sec_fetch_mode:$http_sec_fetch_dest" $auth_error_page {
        default @auth_401;
        ~^(GET|HEAD):navigate:document$ @auth_redirect;
    }

    <%_ for (const upstream of it.upstreams) { %>
    <%_ if (upstream.http) { %>
    <%~ it.indentHttp(upstream.http).trimStart() %>
    <%_ } %>

    upstream <%~ upstream.name %> {
        <%_ if (upstream.resolve) { %>
        zone <%~ upstream.name %> 64k;
        server <%~ upstream.host %>:<%~ upstream.port %> resolve;
        <%_ } else { %>
        server <%~ upstream.host %>:<%~ upstream.port %>;
        <%_ } %>
    }
    <%_ } %>

    <%_ for (const server of it.servers) { %>
    server {
        listen <%~ server.port %> ssl;
        server_name <%~ server.host %>;

        if ($host != $server_name) {
            return 404;
        }
        error_page 497 = @https_redirect;
        location @https_redirect {
            if ($host != $server_name) {
                return 404;
            }
            return 301 https://<%~ server.host %>:<%~ server.port %>$request_uri;
        }

        ssl_certificate     certs/tls.crt;
        ssl_certificate_key certs/tls.key;

        access_log /var/log/nginx/access.log access_log_format;

        <%_ for (const location of server.locations) { %>
        location <%~ location.path %> {
            <%_ if (it.telemetry) { %>
            <%_ if (location.ws) { %>
            otel_trace off;
            <%_ } else { %>
            otel_span_name "$request_method <%~ location.target %>";
            otel_span_attr service.peer.name "<%~ location.upstream %>";
            <%_ } %>

            <%_ } %>

            <%_ if (location.csrf) { %>
            add_header Vary "Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest, Origin, Referer" always;
            if ($csrf_reject) {
                return 403;
            }

            <%_ } %>
            <%_ if (location.auth?.enabled) { %>
            auth_request      /oauth/auth;
            auth_request_set  $authorization $upstream_http_authorization;
            auth_request_set  $access_token $upstream_http_x_auth_request_access_token;
            auth_request_set  $auth_user $upstream_http_x_auth_request_user;
            <%_ /* Explicit clear when oauth2-proxy sets sub as email header value. */ %>
            auth_request_set  $auth_email <%~ it.email ? '$upstream_http_x_auth_request_email' : '""' %>;
            auth_request_set  $auth_set_cookie $upstream_http_set_cookie;
            <%_ if (location.target !== '/oauth/sign_out') { %>
            <%_ /* Propagate refreshed session cookie to downstream user agent. */ %>
            add_header        Set-Cookie $auth_set_cookie;
            <%_ } %>
            error_page        401 = $auth_error_page;
            <%_ } %>
            <%_ for (const [header, value] of Object.entries(location.headers)) { %>
            proxy_set_header <%~ header %> <%~ value %>;
            <%_ } %>
            <%_ for (const [directive, values] of Object.entries(location.directives ?? {})) { %>
                <%_ for (const value of values) { %>
            <%~ directive %><%~ value === '' ? '' : ' ' + value %>;
                <%_ } %>
            <%_ } %>
            <%_ if (location.ssl) { %>
            proxy_ssl_server_name on;
            proxy_ssl_name        <%~ location.ssl.name %>;
            proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
            proxy_ssl_verify              on;
            proxy_ssl_verify_depth        3;
            <%_ } %>
            proxy_pass <%~ location.proxyPass %>;
        }
        <%_ } %>

        location @auth_redirect {
            <%_ if (it.telemetry) { %>
            otel_span_name "$request_method @auth_redirect";
            <%_ } %>
            add_header Set-Cookie $auth_set_cookie always;
            return 302 <%~ it.origin %>/oauth/start?rd=<%~ it.origin %>$request_uri;
        }
        location @auth_401 {
            <%_ if (it.telemetry) { %>
            otel_span_name "$request_method @auth_401";
            <%_ } %>
            add_header Set-Cookie $auth_set_cookie always;
            return 401;
        }
    }
    <%_ } %>
}
`;

const edgeKeyScript = `import fs from 'fs';
export default function value() {
  let key = ngx.shared.edge_key.get('edge_key');
  if (key === undefined) {
    key = fs.readFileSync('/run/secrets/VISAGE_EDGE_KEY', 'utf8').trim();
    ngx.shared.edge_key.set('edge_key', key);
  }
  return key;
}
`;

const otelTemplate = `otel_exporter {
    endpoint \${OTEL_EXPORTER_OTLP_ENDPOINT};
}
otel_service_name \${OTEL_SERVICE_NAME};
otel_resource_attr service.namespace "\${OTEL_SERVICE_NAMESPACE}";
otel_resource_attr service.instance.id "\${HOSTNAME}";
otel_resource_attr service.version "\${NGINX_VERSION}";
otel_trace on;
otel_trace_context propagate;
otel_span_name "$request_method";
`;

export function writeNginxAssets(config: VisageConfig): void {
  const directory = join(config.cache, config.files.nginx);
  mkdirSync(join(directory, 'http.d'), { recursive: true });
  mkdirSync(join(directory, 'templates'), { recursive: true });

  const file = join(directory, 'nginx.conf');
  const render = renderNginxConfig(config);
  writeFileSync(file, render, 'utf-8');

  const edgeKeyFile = join(directory, 'edge-key.js');
  writeFileSync(edgeKeyFile, edgeKeyScript, 'utf-8');

  const otelFile = join(directory, 'templates', 'otel.conf.template');
  writeFileSync(otelFile, otelTemplate, 'utf-8');
}

function indentHttp(http: string): string {
  const lines = http.split('\n');
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.search(/\S/)),
  );
  return lines
    .map((line) => (line.trim() ? '    ' + line.slice(indent) : ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function resolveNginxConfig(config: VisageConfig) {
  const origin = `https://${config.app.host}:${config.app.port}`;
  const referer = `~^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([/?#]|$)`;
  const upstreams = [
    ['app', config.app.upstream, config.app.host] as const,
    ...Object.entries(config.services).flatMap(([name, { upstream, host }]) => {
      if (upstream === undefined) return [];
      return [[name, upstream, host ?? config.app.host] as const];
    }),
    ...Object.entries(config.remotes).map(
      ([name, upstream]) => [name, upstream, config.app.host] as const,
    ),
  ];
  return {
    indentHttp,
    origin,
    referer,
    telemetry: config.telemetry,
    email: config.app.client.scopes.includes('email'),
    cookie_name: JSON.stringify(
      config.app.cookie.cookie_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ).slice(1, -1),
    upstreams: upstreams.map(([name, upstream]) => ({
      name,
      host: upstream.host,
      port: upstream.port,
      http: upstream.http,
      resolve:
        upstream.host === 'host.docker.internal'
          ? process.platform !== 'linux'
          : isIP(upstream.host) === 0,
    })),
    servers: config.hosts.map((host) => ({
      host,
      port: config.app.port,
      locations: upstreams
        .filter(([, , publicHost]) => publicHost === host)
        .flatMap(([name, upstream]) =>
          Object.entries(upstream.locations).map(([path, location]) => ({
            ...location,
            path,
            target: path.replace(/^(?:\^~|~\*|[=~])\s*/, ''),
            upstream: name,
            proxyPass: `${upstream.scheme}://${name}`,
            ssl: upstream.scheme === 'https' ? { name: upstream.host } : false,
          })),
        ),
    })),
  };
}

function renderNginxConfig(config: VisageConfig): string {
  return new Eta({ autoTrim: false }).renderString(
    template,
    resolveNginxConfig(config),
  );
}
