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
server {
    set $public_origin https://localhost:9001;

    js_var $visage_authorization;
    js_var $visage_user;
    js_var $visage_email;

    location / {
        js_access visage;
        proxy_set_header Cookie "";
        proxy_set_header Authorization $visage_authorization;
        proxy_set_header X-Auth-Request-User $visage_user;
        proxy_set_header X-Auth-Request-Email $visage_email;

        location /public/ {
          set $visage_session  off;
          set $visage_exchange off;
          set $upstream_origin http://assets;
          proxy_pass           $upstream_origin;
        }

        location /resources/ {
            set $visage_exchange id;
            set $visage_forward  access;
            set $upstream_origin http://resources;
            proxy_pass           $upstream_origin;
        }
    }
}
```

See the [E2E harness](./test-e2e/nginx.conf) for the full NGINX configuration.

## Custom njs handlers

Compose steps in execution order in a consumer-owned njs module. Import that
module with `js_import` and use it as the location's access handler.

```js
import { compose, session, exchange } from './visage/index.js';

async function requireEmail(ctx, next) {
  if (!ctx.email) return ctx.return(403);
  return next();
}

export default compose(session, requireEmail, exchange);
```

This handler checks the session, enforces the email requirement, and then
exchanges the configured subject token for an audience specific token.
