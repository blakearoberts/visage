import type { Context } from './types.ts';

export async function session(ctx: Context, next: () => Promise<void>) {
  const { public_origin, session_cookie_name, session_endpoint } =
    ctx.variables;
  if (!public_origin) throw new Error('Missing public origin');
  if (!session_cookie_name) throw new Error('Missing session cookie name');
  if (!session_endpoint) throw new Error('Missing session endpoint');

  const session_cookie = ctx.variables['cookie_' + session_cookie_name];
  ctx.session = {
    cookie: session_cookie
      ? `${session_cookie_name}=${session_cookie}`
      : undefined,
  };

  const response = await ngx.fetch(session_endpoint, {
    headers: {
      ...(ctx.session.cookie && { Cookie: ctx.session.cookie }),
      'X-Forwarded-Uri': ctx.variables.request_uri,
    },
  });

  if (response.headers.has('Set-Cookie')) {
    const cookies = response.headers.getAll('Set-Cookie');
    const renewal = cookies.find((value) =>
      value.startsWith(session_cookie_name + '='),
    );
    if (renewal) ctx.session.cookie = renewal.split(';', 1)[0];
    ctx.headersOut['Set-Cookie'] = [
      ...(ctx.headersOut['Set-Cookie'] ?? []),
      ...cookies,
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
    ctx.preferred_username = response.headers.get(
      'X-Auth-Request-Preferred-Username',
    );
    ctx.groups = response.headers.get('X-Auth-Request-Groups');
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
