# TLS and HTTP Mode

Visage currently assumes a local HTTPS origin. That lets the local browser flow
look like the deployed shape: NGINX terminates TLS, OAuth2 Proxy owns the
session cookie, and the OIDC redirect URI uses HTTPS.

Supporting HTTP mode has two separate layers.

## Local HTTP Mode

The first phase is allowing Visage to run without local TLS. In this mode Visage
should not download `mkcert`, install a local certificate authority, generate
certificates, or require local certificate files in the NGINX config.

This mode should also avoid touching `/etc/hosts` when the configured host does
not need it, such as a plain `localhost` setup.

HTTP mode only works when the configured IDP accepts HTTP redirect URIs. Local
Dex can be configured that way. A hosted IDP may reject HTTP redirect URIs
except for special `localhost` allowances, so bring-your-own IDP setups should
expect to keep HTTPS unless their provider explicitly supports local HTTP
callbacks.

## HTTPS Upstreams

The second phase is supporting explicit HTTPS proxying from NGINX to upstream
services. NGINX will not automatically upgrade `proxy_pass http://...` traffic
just because the upstream returns a redirect to HTTPS.

If an upstream requires HTTPS, Visage should render that intent directly:

```nginx
proxy_pass https://upstream;
proxy_ssl_server_name on;
```

That implies an upstream scheme option, probably
`upstreams.*.scheme: "http" | "https"`.

For HTTPS upstreams, Visage will also need policy for SNI and certificate
verification. NGINX supports both, but `proxy_ssl_server_name` defaults off and
`proxy_ssl_verify` defaults off, so those settings should be explicit rather
than accidental.
