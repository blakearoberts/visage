import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { stringify } from 'yaml';

import type { VisageConfig } from '../config';

export function writeComposeConfig(config: VisageConfig): void {
  const file = join(config.cache, config.files.compose);
  const render = renderComposeConfig(config);
  writeFileSync(file, render, 'utf-8');
}

function renderComposeConfig(config: VisageConfig): string {
  const { dex, nginx, oauth2_proxy, ...services } = Object.fromEntries(
    Object.entries(config.services).map(
      ([name, { host: _host, upstream: _upstream, ...service }]) =>
        [name, service] as const,
    ),
  );

  return stringify({
    networks: Object.fromEntries(
      Object.values(config.services).flatMap((service) =>
        (service.networks ?? []).map((name) => [name, {}]),
      ),
    ),
    volumes: config.volumes,
    secrets: Object.fromEntries(
      Object.values(config.services).flatMap(
        ({ secrets }) =>
          secrets?.map((name) => [name, { environment: name }]) ?? [],
      ),
    ),
    services: {
      ...('dex' in config.idp
        ? {
            dex: {
              ...dex,
              volumes: [
                `${config.files.dex[0]}:${config.files.dex[1]}:ro`,
                ...(dex.volumes ?? []),
              ],
            },
          }
        : {}),
      nginx: {
        ...nginx,
        networks: [
          ...new Set([
            ...(nginx.networks ?? []),
            ...Object.entries(config.services)
              .filter(
                ([, service]) =>
                  service.network_mode === undefined &&
                  service.upstream !== undefined,
              )
              .map(([name]) => name),
          ]),
        ],
        environment: {
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otelcol:4317',
          OTEL_SERVICE_NAME: 'nginx',
          OTEL_SERVICE_NAMESPACE: config.package,
          ...nginx.environment,
        },
        ports: [`127.0.0.1:${config.app.port}:${config.app.port}`],
        volumes: [
          `${config.nginx.mount[0]}:${config.nginx.mount[1]}`,
          ...(nginx.volumes ?? []),
        ],
      },
      oauth2_proxy: {
        ...oauth2_proxy,
        volumes: [
          `${config.files.oauth2Proxy[0]}:${config.files.oauth2Proxy[1]}:ro`,
          ...(oauth2_proxy.volumes ?? []),
        ],
      },
      ...services,
    },
  });
}
