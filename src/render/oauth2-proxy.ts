import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from '../config';

export function writeOauth2ProxyConfig(config: VisageConfig): void {
  const file = join(config.cache, config.files.oauth2Proxy[0]);
  const render = renderOauth2ProxyConfig(config);
  writeFileSync(file, render, 'utf-8');

  if (config.oauth2.public) {
    writeFileSync(
      join(config.cache, config.files.oauth2ProxyClientSecret[0]),
      '',
    );
  }
}

function renderOauth2ProxyConfig(config: VisageConfig): string {
  const data = {
    http_address: `0.0.0.0:${config.upstreams.oauth2_proxy.port}`,
    provider: 'oidc',
    oidc_issuer_url: config.idp.issuer,
    skip_oidc_discovery: true,
    login_url: config.idp.authorizationEndpoint,
    redeem_url: config.idp.tokenEndpoint,
    oidc_jwks_url: config.idp.jwksEndpoint,
    redirect_url: `https://${config.host}:${config.port}/oauth2/callback`,
    client_id: config.oauth2.id,
    ...(config.oauth2.secret === undefined
      ? {
          client_secret_file: config.files.oauth2ProxyClientSecret[1],
          code_challenge_method: 'S256',
        }
      : { client_secret: config.oauth2.secret }),
    cookie_secret: createHash('sha256')
      .update('visage:cookie-secret\0')
      .update(config.cache)
      .digest('base64url'),
    ...config.cookie,
    cookie_httponly: true,
    cookie_secure: true,
    cookie_samesite: 'lax',
    email_domains: ['*'],
    scope: config.oauth2.scopes.join(' '),
    upstreams: ['static://202'],
    reverse_proxy: true,
    set_xauthrequest: true,
    pass_access_token: true,
    pass_authorization_header: true,
    skip_provider_button: true,
  };
  return `${Object.entries(data)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        const values = value.map((item) => JSON.stringify(item)).join(', ');
        return `${key} = [${values}]`;
      }

      if (typeof value === 'string') {
        return `${key} = ${JSON.stringify(value)}`;
      }

      return `${key} = ${String(value)}`;
    })
    .join('\n')}\n`;
}
