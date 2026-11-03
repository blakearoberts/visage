import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from '../config';

const LogTimestamp =
  'timestamp="{{slice .Timestamp 0 4}}-{{slice .Timestamp 5 7}}-{{slice .Timestamp 8 10}}T{{slice .Timestamp 11}}Z"';
const LogRequestFields =
  'duration={{.RequestDuration}} url.original={{.RequestURI}} http.response.body.size={{.ResponseSize}} http.response.status_code={{.StatusCode}} upstream.address={{printf "%q" .Upstream}}';
const LogSharedFields =
  'client.address={{printf "%q" .Client}} server.address={{printf "%q" .Host}} network.protocol.version={{printf "%q" (slice .Protocol 5)}} request.id={{printf "%q" .RequestID}} http.request.method={{printf "%q" .RequestMethod}} user_agent.original={{.UserAgent}} user.name={{printf "%q" .Username}}';
const LogMessage = 'message={{printf "%q" .Message}}';

export function writeOauth2ProxyConfig(config: VisageConfig): void {
  const file = join(config.cache, config.files.oauth2Proxy);
  const render = renderOauth2ProxyConfig(config);
  writeFileSync(file, render, 'utf-8');
}

function renderOauth2ProxyConfig(config: VisageConfig): string {
  const port = config.services.oauth2_proxy.upstream!.port;
  const data = {
    http_address: `127.0.0.1:${port}`,
    metrics_address: '0.0.0.0:4181',
    provider: 'oidc',
    proxy_prefix: '/oauth',
    oidc_issuer_url: config.idp.oidc.issuer,
    ...(config.idp.oidc.algs === undefined
      ? {}
      : { oidc_enabled_signing_algs: config.idp.oidc.algs }),
    ...('authorization' in config.idp.oidc
      ? {
          skip_oidc_discovery: true,
          login_url: config.idp.oidc.authorization,
          redeem_url: config.idp.oidc.token,
          oidc_jwks_url: config.idp.oidc.jwks,
        }
      : {}),
    redirect_url: config.app.client.redirectUri,
    client_id: config.app.client.id,
    code_challenge_method: 'S256',
    client_secret_file: config.app.client.public
      ? '/dev/null'
      : '/run/secrets/VISAGE_OAUTH_CLIENT_SECRET',
    ...config.app.cookie,
    cookie_secret_file: '/run/secrets/OAUTH2_PROXY_COOKIE_SECRET',
    cookie_httponly: true,
    cookie_secure: true,
    cookie_samesite: 'lax',
    cookie_csrf_per_request: true,
    cookie_csrf_per_request_limit: 16,
    oidc_email_claim: config.app.client.scopes.includes('email')
      ? 'email'
      : 'sub',
    email_domains: ['*'],
    whitelist_domains: [
      ...new Set([
        config.app.host,
        `${config.app.host}:${config.app.port}`,
        ...(config.idp.oidc.end_session_endpoint
          ? [new URL(config.idp.oidc.end_session_endpoint).host]
          : []),
      ]),
    ] satisfies string[],
    scope: config.app.client.scopes.join(' '),
    reverse_proxy: true,
    trusted_proxy_ips: ['127.0.0.1'],
    set_xauthrequest: true,
    set_authorization_header: true,
    pass_access_token: true,
    skip_provider_button: true,
    approval_prompt: 'auto',
    logging_local_time: false,
    standard_logging_format: `${LogTimestamp} file={{printf "%q" .File}} ${LogMessage}`,
    auth_logging_format: `${LogTimestamp} ${LogSharedFields} event.name={{printf "%q" .Status}} ${LogMessage}`,
    request_logging_format: `${LogTimestamp} ${LogSharedFields} ${LogRequestFields}`,
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
