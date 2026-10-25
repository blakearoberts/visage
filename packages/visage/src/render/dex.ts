import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync, truncates } from 'bcryptjs';
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
    secrets,
    idp: {
      dex: { expiry, sessions, users },
      oidc,
      upstream,
    },
  } = config;
  return stringify({
    issuer: oidc.issuer,
    storage: { type: 'memory' },
    web: { http: `127.0.0.1:${upstream.dex.port}` },
    oauth2: { skipApprovalScreen: true },
    staticClients: [
      {
        id: oauth2.id,
        name: oauth2.id,
        ...(oauth2.public
          ? { public: true }
          : {
              secret: `{{ file.Read "/run/secrets/${secrets.clientSecret}" }}`,
            }),
        refreshTokenLifetime: 'session',
        postLogoutRedirectURIs: [oauth2.postLogoutRedirectUri],
        redirectURIs: [`https://${host}:${port}/oauth2/callback`],
      },
    ],
    enablePasswordDB: true,
    ...(expiry === undefined ? {} : { expiry }),
    ...(sessions === undefined ? {} : { sessions }),
    staticPasswords: users.map(({ password, ...user }) => {
      const length = [...password].length; // Unicode length
      if (length < 15 || length > 64) {
        throw new Error('Password must be between 15 and 64 characters');
      }
      if (truncates(password)) {
        throw new Error('Password must not exceed 72 UTF-8 bytes');
      }
      return { ...user, hash: hashSync(password) };
    }),
  });
}
