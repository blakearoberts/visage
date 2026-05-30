# Config Reload Design

Visage should respond to local configuration edits without requiring the
developer to stop and restart the dev server.

## Goals

- Re-render generated files when Visage options change.
- Keep startup deterministic with `docker compose up --force-recreate`.
- Avoid pretending mounted config files reload services automatically.
- Preserve the OAuth cookie secret across reloads during one Visage process.

## Stage 1: Reconcile by Restarting

On config change, rebuild the resolved Visage config and generated files:

- `compose.yaml`
- `nginx.conf`
- `oauth2-proxy.yml`
- `dex.yaml`, when using managed Dex

Then restart/recreate the managed Compose project using the current startup
path.

## Stage 2: Broad Targeted Reloads

After each config change, compare the rendered outputs with the previous render
and apply the smallest safe action:

- `nginx.conf` changed: write the file, run `nginx -t`, then reload NGINX.
- `oauth2-proxy.yml` changed: restart `oauth2_proxy`.
- `dex.yaml` changed: restart `dex`.
- `compose.yaml` service shape changed: run
  `docker compose up --force-recreate`.

NGINX supports in-process config reload. OAuth2 Proxy and Dex do not support
general config hot-reload for the files Visage generates, so those services
should be restarted when their generated config changes.

## Stage 3: Granular Targeted Reloads

After each config change, compare the regenerated `compose.yaml` to the previous
`compose.yaml`. Restart/recreate only the containers affected by the config
change, and preserve existing containers unaffected by the config change.
