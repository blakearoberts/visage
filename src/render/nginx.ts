import { Eta } from 'eta';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from '../config';

const template = `
events {}

http {
    # Allow WebSockets (Vite HMR).
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    <%_ for (const [name, upstream] of Object.entries(it.upstreams)) { %>
    upstream <%~ name %> {
        server <%~ upstream.host %>:<%~ upstream.port %>;
    }

    <%_ } %>
    server {
        listen <%~ it.port %> ssl;
        server_name <%~ it.host %>;

        ssl_certificate     <%~ it.ssl.cert %>;
        ssl_certificate_key <%~ it.ssl.key %>;

        # Redirect accidental plaintext HTTP requests sent to the HTTPS port.
        error_page 497 =301 https://$http_host$request_uri;

        <%_ for (const [name, upstream] of Object.entries(it.upstreams)) { %>
            <%_ for (const [path, location] of Object.entries(upstream.locations ?? {})) { %>
        location <%~ path %> {
            <%_ if (location.auth?.enabled) { %>
            auth_request      /oauth2/auth;
            auth_request_set  $access_token $upstream_http_x_auth_request_access_token;

            <%_ if (location.auth.redirect) { %>
            error_page 401 =302 /oauth2/start?rd=$scheme://$http_host$request_uri;
            <%_ } %>
            <%_ } %>
            <%_ for (const [header, value] of Object.entries(location.headers ?? {})) { %>
            proxy_set_header <%~ header %> <%~ value %>;
            <%_ } %>
            <%_ if (location.auth?.enabled && location.auth.forward) { %>
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
    upstreams: config.upstreams,
  };
  return new Eta({ autoTrim: false }).renderString(template, data);
}
