# Security Hardening Backlog

These items track outstanding work to improve Visage's default local-development security posture, in priority order.

1. Stop bypass exposure.
   Bind NGINX to loopback and resolve direct Vite exposure so browser traffic cannot bypass the authenticated edge by default.

2. Fix secret permissions.
   Use `0700` for cache directories and `0600` for generated secrets and configs. Do not render confidential OAuth2 client secrets inline.

3. Verify mkcert downloads.
   Pin the downloaded `mkcert` version and verify its checksum before execution.

4. Isolate Docker networks.
   Split edge and app traffic onto separate Docker networks and narrow `trusted_proxy_ips` to the minimum proxy path.

5. Validate generated NGINX inputs.
   Reject inputs that can inject NGINX config or produce unsafe malformed config.

6. Require HTTPS for external IdPs.
   Reject non-HTTPS external IdP issuer and endpoint URLs except for explicit local-development exceptions.

7. Reject unknown Host headers.
   Add a default rejection path for unexpected `Host` headers to avoid redirect and host-header confusion.

8. Redact auth logs.
   Avoid writing OIDC authorization codes, session-adjacent values, or other sensitive auth material to cache logs.

9. Validate cookie weakening options.
   Preserve `__Host-` cookie semantics by default and warn when domain cookie options weaken host-only isolation.

10. Harden containers.
    Run containers with read-only filesystems, `no-new-privileges`, dropped capabilities, and explicit writable `tmpfs` mounts.
