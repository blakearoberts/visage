import type { Context } from './types.ts';

export async function sign_out(ctx: Context, next: () => Promise<void>) {
  const cookies = ctx.headersOut['Set-Cookie'];
  if (cookies && ctx.session?.cookie) {
    const prefix = ctx.variables.session_cookie_name + '=';
    ctx.headersOut['Set-Cookie'] = cookies.filter(
      (cookie) => !cookie.startsWith(prefix),
    );
  }
  return next();
}
