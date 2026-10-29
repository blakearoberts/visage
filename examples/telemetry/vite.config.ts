import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import visage from '@blakearoberts/visage';

export default defineConfig({
  plugins: [
    react(),
    visage({
      oauth2: { scopes: ['openid', 'email', 'offline_access'] },
      telemetry: {},
      volumes: { 'lgtm-data': {} },
      services: {
        otelcol: {
          environment: { OTEL_EXPORTER_OTLP_ENDPOINT: 'grafana:4317' },
        },
        grafana: {
          build: resolve(import.meta.dirname, 'otel-lgtm'),
          environment: {
            GF_AUTH_ANONYMOUS_ENABLED: 'false',
            GF_AUTH_PROXY_ENABLED: 'true',
            GF_AUTH_PROXY_HEADER_NAME: 'X-Auth-Request-Email',
            GF_AUTH_PROXY_HEADER_PROPERTY: 'email',
            GF_SERVER_ROOT_URL: 'https://localhost:9001/grafana/',
            GF_SERVER_SERVE_FROM_SUB_PATH: 'true',
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
          volumes: [
            `${resolve(import.meta.dirname, 'otel-lgtm')}:/otel-lgtm/visage`,
            'lgtm-data:/data',
          ],
          upstream: {
            port: 3000,
            headers: { 'X-Auth-Request-Email': '$auth_email' },
            locations: {
              '/grafana/api/live/': { ws: true },
              '/grafana/': {},
            },
          },
        },
        whoami: { image: 'traefik/whoami' },
      },
    }),
  ],
});
