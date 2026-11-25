# Visage NGINX

Composable NGINX JavaScript (njs) middleware for OAuth and OIDC authentication
and authorization flows.

## Policies

Set `$visage_exchange` to the subject token kind and `$visage_forward` to the
requested token kind (`id` or `access`). Set `$visage_exchange off` to skip
exchange.

```nginx
set $visage_session on;
set $visage_exchange id;
set $visage_forward access;
```

## Getting Started

```nginx
js_import visage from /etc/nginx/visage/index.js;

server {
    set $public_origin https://localhost:9001;
    set $session_cookie_name __Host-sess;

    js_var $visage_authorization;
    js_var $visage_user;
    js_var $visage_email;
    js_var $visage_session_cookie;

    location / {
        proxy_set_header Cookie "";
        proxy_set_header Authorization $visage_authorization;
        proxy_set_header X-Auth-Request-User $visage_user;
        proxy_set_header X-Auth-Request-Email $visage_email;

        location = /oauth/sign_out {
            js_access visage.sign_out;
            proxy_set_header Cookie $visage_session_cookie;
            proxy_pass http://sessions:4180;
        }

        location /public/ {
            proxy_pass http://assets;
        }

        location /resources/ {
            js_access visage.exchange;
            set $visage_exchange id;
            set $visage_forward  access;
            set $upstream_origin http://resources;
            proxy_pass           $upstream_origin;
        }
    }
}
```

See the [E2E harness](./test-e2e/nginx.conf) for the full NGINX configuration.
