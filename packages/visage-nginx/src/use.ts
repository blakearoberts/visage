import type { Context, Middleware } from './types.ts';

function commit(ctx: Context) {
  const vars = ctx.variables as NginxVariables;
  function put(key: string, value: string | undefined) {
    if (key in vars) vars[key] = value ?? '';
  }

  put('visage_user', ctx.user);
  put('visage_email', ctx.email);
  put('visage_preferred_username', ctx.preferred_username);
  put('visage_groups', ctx.groups);
  put('visage_session_cookie', ctx.session?.cookie);

  const { credential: { access_token, id_token } = {} } = ctx;
  const forward = ctx.variables.visage_forward;
  put(
    'visage_authorization',
    forward === 'id' && id_token
      ? `Bearer ${id_token}`
      : forward === 'access' && access_token
        ? `Bearer ${access_token}`
        : '',
  );
}

export function use(...middleware: Middleware[]) {
  return async (request: NginxHTTPRequest) => {
    const ctx: Context = request;
    const next = middleware.reduceRight<() => Promise<void>>(
      (next, step) => () => step(ctx, next),
      async () => commit(ctx),
    );
    try {
      await next();
    } catch (e) {
      ctx.error(String(e));
      return ctx.return(502);
    }
  };
}
