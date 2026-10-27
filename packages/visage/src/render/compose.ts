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
  const { dex, nginx, oauth2_proxy, ...services } = config.services;

  return stringify({
    secrets: {
      [config.secrets.cookieSecret]: {
        environment: config.secrets.cookieSecret,
      },
      [config.secrets.edgeKey]: {
        environment: config.secrets.edgeKey,
      },
      ...(config.oauth2.public
        ? {}
        : {
            [config.secrets.clientSecret]: {
              environment: config.secrets.clientSecret,
            },
          }),
    },
    services: {
      ...('dex' in config.idp
        ? {
            dex: {
              ...dex,
              volumes: [
                `${config.files.dex[0]}:${config.files.dex[1]}:ro`,
                ...(dex.volumes ?? []),
              ],
              ...(config.oauth2.public
                ? {}
                : { secrets: [config.secrets.clientSecret] }),
            },
          }
        : {}),
      nginx: {
        ...nginx,
        environment: {
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otelcol:4317',
          OTEL_SERVICE_NAME: 'nginx',
          OTEL_SERVICE_NAMESPACE: config.package,
          ...nginx.environment,
        },
        secrets: [config.secrets.edgeKey],
        ports: [`127.0.0.1:${config.port}:${config.port}`],
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
        secrets: [
          config.secrets.cookieSecret,
          ...(config.oauth2.public ? [] : [config.secrets.clientSecret]),
        ],
      },
      ...services,
    },
  });
}
