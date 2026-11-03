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
  const services = Object.fromEntries(
    Object.entries(config.services).map(
      ([
        name,
        { host: _host, upstream: _upstream, client: _client, ...service },
      ]) => [name, service] as const,
    ),
  );

  return stringify({
    networks: Object.fromEntries(
      Object.values(config.services).flatMap((service) =>
        (service.networks ?? []).map((name) => [name, {}]),
      ),
    ),
    volumes: Object.fromEntries(
      Object.values(config.services)
        .flatMap(({ volumes }) => volumes)
        .flatMap((volume) =>
          volume.type === 'volume' ? [[volume.source, {}]] : [],
        ),
    ),
    secrets: Object.fromEntries(
      Object.values(config.services).flatMap(
        ({ secrets }) =>
          secrets?.map((name) => [name, { environment: name }]) ?? [],
      ),
    ),
    services: {
      ...services,
      nginx: {
        ...services.nginx,
        networks: [
          ...new Set([
            ...(services.nginx.networks ?? []),
            ...Object.entries(config.services)
              .filter(
                ([, service]) =>
                  service.network_mode === undefined &&
                  service.upstream !== undefined,
              )
              .map(([name]) => name),
          ]),
        ],
      },
    },
  });
}
