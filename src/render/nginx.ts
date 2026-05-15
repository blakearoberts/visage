import { Eta } from 'eta';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from '../config';

const template = `
events {}

http {
    map $time_iso8601 $access_log_time {
        "~^[0-9]{4}-[0-9]{2}-[0-9]{2}T([0-9]{2}:[0-9]{2}:[0-9]{2})" $1;
        default $time_iso8601;
    }

    log_format access_log_format '$access_log_time | $status | $request_method $request_uri | $auth_email | $proxy_host';
    resolver 127.0.0.11 ipv6=off;

    # Allow WebSockets (Vite HMR).
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
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
        set $auth_email "";

        # Redirect accidental plaintext HTTP requests sent to the HTTPS port.
        error_page 497 =301 https://$http_host$request_uri;

        <%_ for (const [name, upstream] of Object.entries(it.upstreams)) { %>
            <%_ for (const [path, location] of Object.entries(upstream.locations ?? {})) { %>
        location <%~ path %> {
            <%_ if (location.auth?.enabled) { %>
            auth_request      /oauth2/auth;
            auth_request_set  $authorization $upstream_http_authorization;
            auth_request_set  $access_token $upstream_http_x_auth_request_access_token;
            auth_request_set  $auth_user $upstream_http_x_auth_request_user;
            auth_request_set  $auth_email $upstream_http_x_auth_request_email;
            auth_request_set  $auth_groups $upstream_http_x_auth_request_groups;
            auth_request_set  $auth_preferred_username $upstream_http_x_auth_request_preferred_username;

            <%_ if (location.auth.redirect) { %>
            error_page 401 =302 /oauth2/start?rd=$scheme://$http_host$request_uri;
            <%_ } %>
            <%_ } %>
            <%_ for (const [header, value] of Object.entries(location.headers ?? {})) { %>
            proxy_set_header <%~ header %> <%~ value %>;
            <%_ } %>
            <%_ for (const [directive, values] of Object.entries(location.directives ?? {})) { %>
                <%_ for (const value of values) { %>
            <%~ directive %> <%~ value %>;
                <%_ } %>
            <%_ } %>
            <%_ if (location.auth?.enabled && location.auth.forward === 'id') { %>
            proxy_set_header Authorization $authorization;
            <%_ } else if (location.auth?.enabled && location.auth.forward === 'access') { %>
            proxy_set_header Authorization "Bearer $access_token";
            <%_ } %>
            <%_ if (upstream.scheme === 'https') { %>
            proxy_ssl_server_name on;
            proxy_ssl_name <%~ upstream.host %>;
            <%_ } %>
            proxy_pass <%~ upstream.scheme %>://<%~ name %>;
        }
            <%_ } %>

        <%_ } %>
    }
}
`;

export function writeNginxConfig(config: VisageConfig): void {
  const file = join(config.cache, config.files.nginx[0]);
  const render = renderNginxConfig(config);
  writeFileSync(file, render, 'utf-8');
}

function renderNginxConfig(config: VisageConfig): string {
  const data = {
    host: config.host,
    port: config.port,
    ssl: {
      cert: join(config.files.certs[1], 'tls.crt'),
      key: join(config.files.certs[1], 'tls.key'),
    },
    upstreams: Object.fromEntries(
      Object.entries(config.upstreams).map(([name, upstream]) => [
        name,
        {
          ...upstream,
          resolve:
            upstream.host === 'host.docker.internal'
              ? process.platform !== 'linux'
              : upstream.external,
        },
      ]),
    ),
  };
  return new Eta({ autoTrim: false }).renderString(template, data);
}
