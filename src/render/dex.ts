import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import { stringify } from 'yaml';

import type { VisageConfig } from '../config';

export function writeDexConfig(config: VisageConfig): void {
  const render = renderDexConfig(config);
  const file = join(config.cache, config.files.dex[0]);
  writeFileSync(file, render, 'utf-8');
}

function renderDexConfig(config: VisageConfig): string {
  if (!('dex' in config.idp)) throw new Error('Dex config missing');
  const {
    host,
    port,
    oauth2,
    idp: {
      dex: { expiry, users },
      oidc,
      upstream,
    },
  } = config;
  return stringify({
    issuer: oidc.issuer,
    storage: { type: 'memory' },
    web: { http: `0.0.0.0:${upstream.dex.port}` },
    oauth2: { skipApprovalScreen: true },
    staticClients: [
      {
        id: oauth2.id,
        name: 'Visage',
        ...(oauth2.secret === undefined
          ? { public: true }
          : { secret: oauth2.secret }),
        redirectURIs: [`https://${host}:${port}/oauth2/callback`],
      },
    ],
    enablePasswordDB: true,
    ...(expiry === undefined ? {} : { expiry }),
    staticPasswords: users.map(({ password, ...user }) => ({
      ...user,
      hash: hashSync(password),
    })),
  });
}
