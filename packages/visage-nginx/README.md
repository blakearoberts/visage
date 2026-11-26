# Visage NGINX

Composable NGINX JavaScript (njs) middleware for OAuth and OIDC authentication
and authorization flows.

## Getting Started

```nginx
http {
    resolver 127.0.0.11 ipv6=off; # Docker DNS
    js_engine qjs;
    js_import visage from /etc/nginx/visage/index.js;

    server {
        listen 80;

        include /etc/nginx/visage/session.conf;

        location / {
            js_access        visage.session;
            proxy_set_header Cookie "";
            proxy_pass       http://resource;
        }

        location /public/ {
            proxy_set_header Cookie "";
            proxy_pass       http://assets;
        }

        location /api/ {
            js_access visage.exchange;

            set $exchange_endpoint  http://dex.localhost:5556/token;
            set $exchange_connector session-issuer;

            set $visage_exchange id;
            set $visage_forward  access;
            set $upstream_origin http://resources.localhost;
            proxy_set_header     Cookie "";
            proxy_set_header     Authorization $visage_authorization;
            proxy_pass           $upstream_origin;
        }
    }
}
```

See the [E2E harness](./test-e2e/nginx.conf) for the full NGINX configuration.

## Policies

### OIDC Application Cookie Session (oauth2-proxy)

```nginx
include /etc/nginx/visage/session.conf;

location / {
    js_access        visage.session;
    proxy_set_header Cookie "";
    proxy_pass       http://app;
}
```

### Token Exchange

Set `$visage_exchange` to the subject token kind and `$visage_forward` to the
requested token kind (`id` or `access`). Mount the client secret for
`$public_origin` at `/run/secrets/VISAGE_APP_CLIENT_SECRET`.

```nginx
include /etc/nginx/visage/session.conf;

location /api/ {
    js_access visage.exchange;

    set $exchange_endpoint  http://dex.localhost:5556/token;
    set $exchange_connector session-issuer;

    set $visage_exchange id;
    set $visage_forward  access;
    set $upstream_origin http://resources.localhost;
    proxy_set_header     Cookie "";
    proxy_set_header     Authorization $visage_authorization;
    proxy_pass           $upstream_origin;
}
```
