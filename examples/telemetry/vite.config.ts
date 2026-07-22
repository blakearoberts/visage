import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import visage from '@blakearoberts/visage';

export default defineConfig({
  plugins: [
    react(),
    visage({
      oauth2: { scopes: ['openid', 'email', 'offline_access'] },
      services: {
        nginx: {
          build: resolve(import.meta.dirname, 'nginx'),
          image: 'visage-nginx-otel',
          pull_policy: 'build',
        },
        grafana: {
          image: 'grafana/otel-lgtm',
          environment: {
            GF_AUTH_ANONYMOUS_ENABLED: 'false',
            GF_AUTH_PROXY_ENABLED: 'true',
            GF_AUTH_PROXY_HEADER_NAME: 'X-Auth-Request-Email',
            GF_AUTH_PROXY_HEADER_PROPERTY: 'email',
            GF_SERVER_ROOT_URL: 'https://localhost:9001/grafana/',
            GF_SERVER_SERVE_FROM_SUB_PATH: 'true',
            GF_USERS_AUTO_ASSIGN_ORG_ROLE: 'Editor',
            GF_PATHS_PROVISIONING: '/otel-lgtm/visage/provisioning',
            OTELCOL_EXTRA_ARGS:
              '--config=file:/otel-lgtm/visage/otelcol-config.yaml',
            TEMPO_EXTRA_ARGS:
              '--config.file=/otel-lgtm/visage/tempo-config.yaml',
          },
          volumes: [
            `${resolve(import.meta.dirname, 'otel-lgtm')}:/otel-lgtm/visage:ro`,
          ],
          upstream: {
            port: 3000,
            headers: {
              'X-Auth-Request-Email': '$auth_email',
            },
            locations: {
              '/grafana/api/live/': { ws: true },
              '/grafana/': {},
            },
          },
        },
      },
      upstreams: {
        otelcol: {
          host: 'grafana',
          scheme: 'http',
          port: 4318,
          locations: {
            '/t/': {
              directives: { rewrite: '^/t/(.*)$ /$1 break' },
            },
          },
        },
      },
    }),
  ],
});
