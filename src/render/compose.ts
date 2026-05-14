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
    services: {
      ...(config.idp.dex !== undefined
        ? {
            dex: {
              ...config.services.dex,
              volumes: [`${config.files.dex[0]}:${config.files.dex[1]}:ro`],
            },
          }
        : {}),
      nginx: {
        ...config.services.nginx,
        ports: [`${config.port}:${config.port}`],
        volumes: [config.files.certs, config.files.nginx].map(
          ([from, to]) => `${from}:${to}:ro`,
        ),
      },
      oauth2_proxy: {
        ...config.services.oauth2_proxy,
        volumes: [
          `${config.files.oauth2Proxy[0]}:${config.files.oauth2Proxy[1]}:ro`,
          ...(config.oauth2.public
            ? [
                `${config.files.clientSecret[0]}:${config.files.clientSecret[1]}:ro`,
              ]
            : []),
        ],
      },
      ...services,
    },
  });
}
