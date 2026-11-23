import type { Context } from './auth.ts';

export async function session(ctx: Context, next: () => Promise<void>) {
  const { public_origin, session_endpoint } = ctx.variables;
  if (!public_origin) throw new Error('Missing public origin');
  if (!session_endpoint) throw new Error('Missing session endpoint');

  const response = await ngx.fetch(session_endpoint, {
    headers: {
      Cookie: ctx.headersIn.Cookie ?? '',
      'X-Forwarded-Uri': ctx.variables.request_uri,
    },
  });

  if (response.headers.has('Set-Cookie')) {
    ctx.headersOut['Set-Cookie'] = [
      ...(ctx.headersOut['Set-Cookie'] ?? []),
      ...response.headers.getAll('Set-Cookie'),
    ];
  }

  if (response.status === 202) {
    const bearer = response.headers
      .get('Authorization')
      ?.match(/^(Bearer) (\S+)$/i);
    if (!bearer) return ctx.return(502);
    const [, token_type, id_token] = bearer;
    ctx.user = response.headers.get('X-Auth-Request-User');
    ctx.email = response.headers.get('X-Auth-Request-Email');
    ctx.credential = {
      token_type,
      id_token,
      access_token: response.headers.get('X-Auth-Request-Access-Token'),
    };
    return next();
  }

  const challenge = response.headers.get('WWW-Authenticate');
  if (challenge) ctx.headersOut['WWW-Authenticate'] = challenge;
  if (response.status !== 401 && response.status !== 403) {
    return ctx.return(502);
  }

  const { request_method, http_sec_fetch_mode, http_sec_fetch_dest } =
    ctx.variables;
  const navigation =
    (request_method === 'GET' || request_method === 'HEAD') &&
    http_sec_fetch_mode === 'navigate' &&
    http_sec_fetch_dest === 'document';
  if (!navigation) return ctx.return(401);

  return ctx.return(
    302,
    public_origin +
      '/oauth/start?rd=' +
      encodeURIComponent(public_origin + ctx.variables.request_uri),
  );
}
