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
              ...config.services.dex,
              volumes: [
                `${config.files.dex[0]}:${config.files.dex[1]}:ro`,
                ...(config.services.dex.volumes ?? []),
              ],
              ...(config.oauth2.public
                ? {}
                : { secrets: [config.secrets.clientSecret] }),
            },
          }
        : {}),
      nginx: {
        ...config.services.nginx,
        secrets: [config.secrets.edgeKey],
        ports: [`127.0.0.1:${config.port}:${config.port}`],
        volumes: [
          ...[
            config.files.certs,
            config.files.nginx,
            config.files.nginxEdgeKeyJS,
          ].map(([from, to]) => `${from}:${to}:ro`),
          ...(config.services.nginx.volumes ?? []),
        ],
      },
      oauth2_proxy: {
        ...config.services.oauth2_proxy,
        volumes: [
          `${config.files.oauth2Proxy[0]}:${config.files.oauth2Proxy[1]}:ro`,
          ...(config.services.oauth2_proxy.volumes ?? []),
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
