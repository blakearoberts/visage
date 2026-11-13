import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import visage from '@blakearoberts/visage';

export default defineConfig({
  plugins: [
    react(),
    visage({
      telemetry: true,
      services: {
        dex: { host: 'idp.localhost' },
        otelcol: {
          networks: ['grafana'],
          environment: { OTEL_EXPORTER_OTLP_ENDPOINT: 'grafana:4317' },
        },
        grafana: {
          host: 'g.localhost',
          client: {
            id: 'grafana',
            scopes: ['openid', 'email', 'offline_access'],
            redirectUri: 'https://g.localhost:9001/login/generic_oauth',
          },
          build: resolve(import.meta.dirname, 'otel-lgtm'),
          environment: {
            GF_AUTH_ANONYMOUS_ENABLED: 'false',
            GF_AUTH_DISABLE_LOGIN_FORM: 'true',
            GF_AUTH_GENERIC_OAUTH_ENABLED: 'true',
            GF_AUTH_GENERIC_OAUTH_AUTO_LOGIN: 'true',
            GF_AUTH_GENERIC_OAUTH_CLIENT_ID: 'grafana',
            GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET:
              '$$__file{/run/secrets/VISAGE_GRAFANA_CLIENT_SECRET}',
            GF_AUTH_GENERIC_OAUTH_SCOPES: 'openid email offline_access',
            GF_AUTH_GENERIC_OAUTH_AUTH_URL:
              'https://idp.localhost:9001/dex/auth',
            GF_AUTH_GENERIC_OAUTH_TOKEN_URL:
              'https://idp.localhost:9001/dex/token',
            GF_AUTH_GENERIC_OAUTH_API_URL:
              'https://idp.localhost:9001/dex/userinfo',
            GF_AUTH_GENERIC_OAUTH_USE_PKCE: 'true',
            GF_AUTH_GENERIC_OAUTH_USE_REFRESH_TOKEN: 'true',
            GF_AUTH_GENERIC_OAUTH_TLS_CLIENT_CA: '/etc/ssl/certs/visage.pem',
            GF_SECURITY_COOKIE_SECURE: 'true',
            GF_SERVER_ROOT_URL: 'https://g.localhost:9001/',
            GF_USERS_AUTO_ASSIGN_ORG_ROLE: 'Editor',
            GF_PATHS_PROVISIONING: '/otel-lgtm/visage/provisioning',
            GF_PATHS_PERMITTED_PROVISIONING_PATHS:
              '/otel-lgtm/visage/dashboards',
            TEMPO_EXTRA_ARGS:
              '--config.file=/otel-lgtm/visage/tempo-config.yaml',
            PROMETHEUS_EXTRA_ARGS: '--storage.tsdb.retention.time=24h',
            LOKI_EXTRA_ARGS:
              '-store.retention=24h -compactor.retention-enabled=true -compactor.delete-request-store=filesystem',
          },
          mounts: {
            '/data': { volume: 'lgtm-data' },
            '/etc/ssl/certs/visage.pem': {
              bind: resolve(
                import.meta.dirname,
                'node_modules/.vite/visage/nginx/certs/ca.crt',
              ),
              read_only: true,
            },
            '/otel-lgtm/grafana/data/plugins-bundled': {},
            '/otel-lgtm/visage': {
              bind: resolve(import.meta.dirname, 'otel-lgtm'),
              read_only: true,
            },
            '/otel-lgtm/visage/dashboards': {
              bind: resolve(import.meta.dirname, 'otel-lgtm/dashboards'),
            },
            '/tmp': {},
          },
          upstream: {
            port: 3000,
            auth: { enabled: false },
            headers: { Cookie: '$http_cookie' },
            ws: true,
          },
        },
        whoami: { image: 'traefik/whoami' },
      },
    }),
  ],
});
