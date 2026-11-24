import type { Context, Middleware } from './types.ts';

export function use(...middleware: Middleware[]) {
  return async (request: NginxHTTPRequest) => {
    const ctx: Context = request;
    const next = middleware.reduceRight<() => Promise<void>>(
      (next, step) => () => step(ctx, next),
      async () => {
        const { credential: { access_token, id_token } = {} } = ctx;
        const forward = ctx.variables.visage_forward;
        request.variables.visage_authorization =
          forward === 'id' && id_token
            ? `Bearer ${id_token}`
            : forward === 'access' && access_token
              ? `Bearer ${access_token}`
              : '';
        request.variables.visage_user = ctx.user ?? '';
        request.variables.visage_email = ctx.email ?? '';
        request.variables.visage_session_cookie = ctx.session?.cookie ?? '';
      },
    );
    try {
      await next();
    } catch (e) {
      ctx.error(String(e));
      return ctx.return(502);
    }
  };
}
