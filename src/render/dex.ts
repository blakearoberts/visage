import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import { stringify } from 'yaml';

import type { VisageConfig } from '../config';

export function writeDexConfig(config: VisageConfig): void {
  const file = join(config.cache, config.files.dex[0]);
  const render = renderDexConfig(config);
  writeFileSync(file, render, 'utf-8');
}

function renderDexConfig(config: VisageConfig): string {
  if (config.idp.kind !== 'dex') {
    throw new Error('Dex config is required to render Dex');
  }

  const origin = `https://${config.host}:${config.port}`;
  const redirect = `${origin}/oauth2/callback`;
  const upstream = config.upstreams[config.idp.upstream];
  return stringify({
    issuer: config.idp.issuer,
    storage: { type: 'memory' },
    web: { http: `0.0.0.0:${upstream.port}` },
    oauth2: { skipApprovalScreen: true },
    staticClients: [
      {
        id: config.oauth2.id,
        name: 'Visage',
        ...(config.oauth2.secret === undefined
          ? { public: true }
          : { secret: config.oauth2.secret }),
        redirectURIs: [redirect],
      },
    ],
    enablePasswordDB: true,
    ...(config.idp.dex.expiry === undefined
      ? {}
      : { expiry: config.idp.dex.expiry }),
    staticPasswords: config.idp.dex.users.map(({ password, ...user }) => ({
      ...user,
      hash: hashSync(password, 10),
    })),
  });
}
