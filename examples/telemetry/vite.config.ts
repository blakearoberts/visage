import visage from '@blakearoberts/visage';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
          build: './otel-lgtm',
          environment: {
            TEMPO_EXTRA_ARGS:
              '--config.file=/otel-lgtm/visage/tempo-config.yaml',
            PROMETHEUS_EXTRA_ARGS: '--storage.tsdb.retention.time=24h',
            LOKI_EXTRA_ARGS:
              '-store.retention=24h -compactor.retention-enabled=true -compactor.delete-request-store=filesystem',
          },
          mounts: {
            '/data': { volume: 'lgtm-data' },
            '/otel-lgtm/grafana/conf/custom.ini': {
              bind: './otel-lgtm/grafana.ini',
              read_only: true,
            },
            '/otel-lgtm/grafana/data/plugins-bundled': {},
            '/otel-lgtm/visage': { bind: './otel-lgtm', read_only: true },
            '/otel-lgtm/visage/dashboards': { bind: './otel-lgtm/dashboards' },
            '/tmp': {},
          },
          upstream: {
            port: 3000,
            headers: { Cookie: '$http_cookie' },
            ws: true,
          },
        },
        whoami: { image: 'traefik/whoami' },
      },
    }),
  ],
});
