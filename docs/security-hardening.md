# Security Hardening Backlog

These items track outstanding work to improve Visage's default local-development security posture, in priority order.

1. Fix secret permissions.
   Use `0700` for cache directories and `0600` for generated secrets and configs.

2. Verify mkcert downloads.
   Pin the downloaded `mkcert` version and verify its checksum before execution.

3. Isolate Docker networks.
   Split edge and app traffic onto separate Docker networks and narrow `trusted_proxy_ips` to the minimum proxy path.

4. Validate generated NGINX inputs.
   Reject inputs that can inject NGINX config or produce unsafe malformed config.

5. Require HTTPS for external IdPs.
   Reject non-HTTPS external IdP issuer and endpoint URLs except for explicit local-development exceptions.

6. Reject unknown Host headers.
   Add a default rejection path for unexpected `Host` headers to avoid redirect and host-header confusion.

7. Redact auth logs.
   Avoid writing OIDC authorization codes, session-adjacent values, or other sensitive auth material to cache logs.

8. Validate cookie weakening options.
   Preserve `__Host-` cookie semantics by default and warn when domain cookie options weaken host-only isolation.

9. Harden containers.
   Run containers with read-only filesystems, `no-new-privileges`, dropped capabilities, and explicit writable `tmpfs` mounts.
