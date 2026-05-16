import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from '../config';

const LogTS = '{{slice .Timestamp 11 19}}';
const LogReqURI =
  '{{printf "%.*s" (len (slice .RequestURI 2)) (slice .RequestURI 1)}}';
const LogFormats = {
  standard_logging_format: `${LogTS} | [{{.File}}] {{.Message}}`,
  request_logging_format: `${LogTS} | {{.StatusCode}} | {{.RequestMethod}} ${LogReqURI} | {{.Username}} | {{.Upstream}}`,
  auth_logging_format: `${LogTS} | {{.Status}} | {{.Username}} | {{.Message}}`,
};

export function writeOauth2ProxyConfig(config: VisageConfig): void {
  const file = join(config.cache, config.files.oauth2Proxy[0]);
  const render = renderOauth2ProxyConfig(config);
  writeFileSync(file, render, 'utf-8');

  if (config.oauth2.public) {
    writeFileSync(join(config.cache, config.files.clientSecret[0]), '');
  }

  const cookieSecretFile = join(config.cache, config.files.cookieSecret[0]);
  if (!existsSync(cookieSecretFile)) {
    const secret = randomBytes(32).toString('base64url');
    writeFileSync(cookieSecretFile, secret, { encoding: 'utf-8', mode: 0o644 });
  }
  chmodSync(cookieSecretFile, 0o644);
}

function renderOauth2ProxyConfig(config: VisageConfig): string {
  const data = {
    http_address: `0.0.0.0:${config.upstreams.oauth2_proxy.port}`,
    provider: 'oidc',
    oidc_issuer_url: config.idp.oidc.issuer,
    ...('authorization' in config.idp.oidc
      ? {
          skip_oidc_discovery: true,
          login_url: config.idp.oidc.authorization,
          redeem_url: config.idp.oidc.token,
          oidc_jwks_url: config.idp.oidc.jwks,
        }
      : {}),
    redirect_url: `https://${config.host}:${config.port}/oauth2/callback`,
    client_id: config.oauth2.id,
    ...(config.oauth2.secret === undefined
      ? {
          client_secret_file: config.files.clientSecret[1],
          code_challenge_method: 'S256',
        }
      : { client_secret: config.oauth2.secret }),
    ...config.cookie,
    cookie_httponly: true,
    cookie_secure: true,
    cookie_samesite: 'lax',
    cookie_csrf_per_request: true,
    cookie_csrf_per_request_limit: 16,
    email_domains: config.oauth2.emailDomains,
    whitelist_domains: [config.host, `${config.host}:${config.port}`],
    scope: config.oauth2.scopes.join(' '),
    reverse_proxy: true,
    trusted_proxy_ips: config.network.trustedProxyIps,
    set_xauthrequest: true,
    set_authorization_header: true,
    pass_access_token: true,
    skip_provider_button: true,
    approval_prompt: 'auto',
    ...LogFormats,
  };
  return `${Object.entries(data)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        const values = value.map((item) => JSON.stringify(item)).join(', ');
        return `${key} = [${values}]`;
      }
      if (typeof value === 'string') return `${key} = ${JSON.stringify(value)}`;
      return `${key} = ${String(value)}`;
    })
    .join('\n')}\n`;
}
