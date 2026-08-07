import { Eta } from 'eta';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';

import { VisageEdgeKeyHeader, type VisageConfig } from '../config';

const template = `
<%_ for (const module of it.modules) { %>
load_module <%~ module %>;
<%_ } %>

events {}

http {
    js_import edge_key from <%~ it.edgeKey.script %>;
    js_shared_dict_zone zone=edge_key:32k;
    js_set $edge_key edge_key;

    <%_ if (it.telemetry) { %>
    include /etc/nginx/http.d/otel.conf;
    <%_ } %>

    # Disable IPv6 DNS lookup. Docker Desktop (com.docker.backend), doesn't
    # support IPv6 traffic translation to host loopback.
    resolver 127.0.0.11 ipv6=off;

    # Configure access log format.
    map $time_iso8601 $access_log_time {
        "~^[0-9]{4}-[0-9]{2}-[0-9]{2}T([0-9]{2}:[0-9]{2}:[0-9]{2})" $1;
        default $time_iso8601;
    }
    log_format access_log_format '$access_log_time | $status | $request_method $request_uri | $auth_user | $proxy_host';

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
        "<%~ it.csrf.origin %>" match;
    }
    map $http_referer $csrf_referer {
        default invalid;
        ''      absent;
        "<%~ it.csrf.referer %>" match;
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

    <%_ for (const [name, upstream] of Object.entries(it.upstreams)) { %>

    upstream <%~ name %> {
        <%_ if (upstream.resolve) { %>
        zone <%~ name %> 64k;
        server <%~ upstream.host %>:<%~ upstream.port %> resolve;
        <%_ } else { %>
        server <%~ upstream.host %>:<%~ upstream.port %>;
        <%_ } %>
    }
    <%_ } %>

    server {
        listen <%~ it.port %> ssl;
        server_name <%~ it.host %>;

        ssl_certificate     <%~ it.ssl.cert %>;
        ssl_certificate_key <%~ it.ssl.key %>;

        access_log /var/log/nginx/access.log access_log_format;

        # Redirect HTTP to HTTPS.
        error_page 497 =301 https://$http_host$request_uri;

        <%_ for (const [name, upstream] of Object.entries(it.upstreams)) { %>
        <%_ for (const [path, location] of Object.entries(upstream.locations)) { %>
        location <%~ path %> {
            <%_ if (it.telemetry) { %>
            otel_span_name "$request_method <%~ location.target %>";

            <%_ } %>

            <%_ if (location.csrf) { %>
            add_header Vary "Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest, Origin, Referer" always;
            if ($csrf_reject) {
                return 403;
            }

            <%_ } %>
            <%_ if (location.auth?.enabled) { %>
            auth_request      /oauth2/auth;
            auth_request_set  $authorization $upstream_http_authorization;
            auth_request_set  $access_token $upstream_http_x_auth_request_access_token;
            auth_request_set  $auth_user $upstream_http_x_auth_request_user;
            <%_ /* Explicit clear when oauth2-proxy sets sub as email header value. */ %>
            auth_request_set  $auth_email <%~ it.email ? '$upstream_http_x_auth_request_email' : '""' %>;
            <%_ /* Propagate refreshed session cookie. */ %>
            auth_request_set  $auth_cookie $upstream_http_set_cookie;
            add_header        Set-Cookie $auth_cookie;
            error_page        401 = $auth_error_page;
            <%_ } %>
            <%_ if (name === 'vite') { %>
            proxy_set_header <%~ it.edgeKey.header %> $edge_key;
            <%_ } %>
            <%_ for (const [header, value] of Object.entries(location.headers ?? {})) { %>
            proxy_set_header <%~ header %> <%~ value %>;
            <%_ } %>
            <%_ for (const [directive, values] of Object.entries(location.directives ?? {})) { %>
                <%_ for (const value of values) { %>
            <%~ directive %><%~ value === '' ? '' : ' ' + value %>;
                <%_ } %>
            <%_ } %>
            <%_ if (upstream.scheme === 'https') { %>
            proxy_ssl_server_name on;
            proxy_ssl_name        <%~ upstream.host %>;
            <%_ if (upstream.external) { %>
            proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
            proxy_ssl_verify              on;
            proxy_ssl_verify_depth        3;
            <%_ } %>
            <%_ } %>
            proxy_pass <%~ upstream.scheme %>://<%~ name %>;
        }
        <%_ } %>

        <%_ } %>
        location @auth_redirect {
            <%_ if (it.telemetry) { %>
            otel_span_name "$request_method @auth_redirect";
            <%_ } %>
            return 302 /oauth2/start?rd=$scheme://$http_host$request_uri;
        }
        location @auth_401 {
            <%_ if (it.telemetry) { %>
            otel_span_name "$request_method @auth_401";
            <%_ } %>
            return 401;
        }
    }
}
`;

const renderEdgeKeyJS = (file: string) => `import fs from 'fs';
export default function value() {
  let key = ngx.shared.edge_key.get('edge_key');
  if (key === undefined) {
    key = fs.readFileSync('/run/secrets/${file}', 'utf8').trim();
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
  const directory = join(config.cache, config.nginx.mount[0]);
  mkdirSync(join(directory, 'http.d'), { recursive: true });
  mkdirSync(join(directory, 'templates'), { recursive: true });

  const file = join(directory, 'nginx.conf');
  const render = renderNginxConfig(config);
  writeFileSync(file, render, 'utf-8');

  const edgeKeyFile = join(directory, 'edge-key.js');
  const edgeKeyRender = renderEdgeKeyJS(config.secrets.edgeKey);
  writeFileSync(edgeKeyFile, edgeKeyRender, 'utf-8');

  const otelFile = join(directory, 'templates', 'otel.conf.template');
  writeFileSync(otelFile, otelTemplate, 'utf-8');
}

function renderNginxConfig(config: VisageConfig): string {
  const origin = `https://${config.host}:${config.port}`;
  const referer = `~^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([/?#]|$)`;
  const data = {
    host: config.host,
    port: config.port,
    telemetry: config.telemetry,
    modules: config.nginx.modules,
    email: config.oauth2.scopes.includes('email'),
    csrf: { origin, referer },
    ssl: {
      cert: join(config.nginx.mount[1], 'certs', 'tls.crt'),
      key: join(config.nginx.mount[1], 'certs', 'tls.key'),
    },
    edgeKey: {
      header: VisageEdgeKeyHeader,
      script: join(config.nginx.mount[1], 'edge-key.js'),
    },
    upstreams: Object.fromEntries(
      Object.entries(config.upstreams).map(([name, upstream]) => [
        name,
        {
          ...upstream,
          locations: Object.fromEntries(
            Object.entries(upstream.locations).map(([path, location]) => [
              path,
              {
                ...location,
                target: path.replace(/^(?:\^~|~\*|[=~])\s*/, ''),
              },
            ]),
          ),
          resolve:
            upstream.host === 'host.docker.internal'
              ? process.platform !== 'linux'
              : isIP(upstream.host) === 0,
        },
      ]),
    ),
  };
  return new Eta({ autoTrim: false }).renderString(template, data);
}
