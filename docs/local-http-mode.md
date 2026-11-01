# Local HTTP Mode

Visage currently assumes a local HTTPS origin. That lets the local browser flow
look like the deployed shape: NGINX terminates TLS, OAuth2 Proxy owns the
session cookie, and the OIDC redirect URI uses HTTPS.

Supporting HTTP mode means allowing Visage to run without local TLS. Visage
should not download `mkcert`, install a local certificate authority, generate
certificates, or require local certificate files in the NGINX config.

This mode should also avoid touching `/etc/hosts` when the configured host does
not need it, such as a plain `localhost` setup.

HTTP mode only works when the configured IDP accepts HTTP redirect URIs. Local
Dex can be configured that way. A hosted IDP may reject HTTP redirect URIs
except for special `localhost` allowances, so bring-your-own IDP setups should
expect to keep HTTPS unless their provider explicitly supports local HTTP
callbacks.
