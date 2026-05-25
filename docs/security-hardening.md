# Security Hardening Backlog

These items track outstanding work to improve Visage's default local-development security posture, in priority order.

1. Isolate Docker networks.
   Split edge and app traffic onto separate Docker networks and narrow `trusted_proxy_ips` to the minimum proxy path.

2. Validate generated NGINX inputs.
   Reject inputs that can inject NGINX config or produce unsafe malformed config.

3. Require HTTPS for external IdPs.
   Reject non-HTTPS external IdP issuer and endpoint URLs except for explicit local-development exceptions.

4. Reject unknown Host headers.
   Add a default rejection path for unexpected `Host` headers to avoid redirect and host-header confusion.

5. Redact auth logs.
   Avoid writing OIDC authorization codes, session-adjacent values, or other sensitive auth material to cache logs.

6. Validate cookie weakening options.
   Preserve `__Host-` cookie semantics by default and warn when domain cookie options weaken host-only isolation.

7. Harden containers.
   Run containers with read-only filesystems, `no-new-privileges`, dropped capabilities, and explicit writable `tmpfs` mounts.
