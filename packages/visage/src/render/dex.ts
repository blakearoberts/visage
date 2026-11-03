import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync, truncates } from 'bcryptjs';
import { stringify } from 'yaml';

import type { VisageConfig } from '../config';

export function writeDexConfig(config: VisageConfig): void {
  const render = renderDexConfig(config);
  const file = join(config.cache, config.files.dex);
  writeFileSync(file, render, 'utf-8');
}

/** @internal Exported for unit testing. */
export function validateDexPassword(password: string): void {
  const length = [...password].length; // Unicode length
  if (length < 15 || length > 64) {
    throw new Error('Password must be between 15 and 64 characters');
  }
  if (truncates(password)) {
    throw new Error('Password must not exceed 72 UTF-8 bytes');
  }
}

function renderDexConfig(config: VisageConfig): string {
  if (!('dex' in config.idp)) throw new Error('Dex config missing');
  const {
    app: { client },
    idp: {
      dex: { expiry, sessions, users },
      oidc,
    },
  } = config;
  return stringify({
    issuer: oidc.issuer,
    storage: { type: 'memory' },
    web: { http: new URL(oidc.token).host },
    oauth2: { skipApprovalScreen: true },
    staticClients: [
      ['VISAGE_OAUTH_CLIENT_SECRET', client] as const,
      ...Object.entries(config.services).map(
        ([name, { client }]) =>
          [`VISAGE_${name}_CLIENT_SECRET`, client] as const,
      ),
    ].flatMap(([secret, client]) =>
      client
        ? [
            {
              id: client.id,
              name: client.id,
              ...(client.public
                ? { public: true }
                : { secret: `{{ file.Read "/run/secrets/${secret}" }}` }),
              refreshTokenLifetime: 'session',
              postLogoutRedirectURIs: [client.postLogoutRedirectUri],
              redirectURIs: [client.redirectUri],
            },
          ]
        : [],
    ),
    enablePasswordDB: true,
    ...(expiry === undefined ? {} : { expiry }),
    ...(sessions === undefined ? {} : { sessions }),
    staticPasswords: users.map(({ password, ...user }) => {
      validateDexPassword(password);
      return { ...user, hash: hashSync(password) };
    }),
  });
}
