import fs from 'fs';
import querystring from 'querystring';

import type { Context, Credential } from './auth.ts';

export async function exchange(ctx: Context, next: () => Promise<void>) {
  const { credential = {}, variables } = ctx;
  const audience = variables.upstream_origin;
  const clientId = variables.public_origin;
  const connector = variables.exchange_connector;
  const endpoint = variables.exchange_endpoint;
  const subject =
    variables.visage_exchange === 'id'
      ? credential.id_token
      : variables.visage_exchange === 'access'
        ? credential.access_token
        : undefined;
  if (!audience || !clientId || !connector || !endpoint || !subject) {
    throw new Error('Missing token exchange configuration');
  }

  const secret = fs.readFileSync(
    '/run/secrets/VISAGE_APP_CLIENT_SECRET',
    'utf8',
  );
  const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`;
  const response = await ngx.fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(credentials).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: querystring.stringify({
      connector_id: connector,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: `urn:ietf:params:oauth:token-type:${variables.visage_forward}_token`,
      scope: `audience:server:client_id:${audience}`,
      subject_token: subject,
      subject_token_type: `urn:ietf:params:oauth:token-type:${variables.visage_exchange}_token`,
    }),
  });
  if (!response.ok) throw new Error('Token exchange failed');
  const issued: Credential = await response.json();
  if (
    issued.issued_token_type === 'urn:ietf:params:oauth:token-type:id_token'
  ) {
    // exchange responses carry the id_token in access_token
    // https://www.rfc-editor.org/rfc/rfc8693.html#section-2.2.1
    const { access_token, ...rest } = issued;
    ctx.credential = { ...rest, id_token: access_token };
  } else {
    ctx.credential = issued;
  }
  return next();
}
