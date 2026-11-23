import { exchange } from './exchange.ts';
import { session } from './session.ts';

export type Credential = {
  readonly access_token?: string;
  readonly id_token?: string;
  readonly issued_token_type?: string;
  readonly refresh_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly scope?: string;
};

export type Context = Omit<NginxHTTPRequest, 'rawVariables' | 'variables'> & {
  readonly rawVariables: Readonly<NginxRawVariables>;
  readonly variables: Readonly<NginxVariables>;
  credential?: Credential;
  user?: string;
  email?: string;
};

export type Middleware = (
  ctx: Context,
  next: () => Promise<void>,
) => Promise<void>;

export function compose(...steps: Middleware[]) {
  return async (request: NginxHTTPRequest) => {
    const ctx: Context = request;
    const next = steps.reduceRight<() => Promise<void>>(
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
      },
    );
    try {
      await next();
    } catch {
      return ctx.return(502);
    }
  };
}

export default function js_access(request: NginxHTTPRequest) {
  const { visage_session, visage_exchange } = request.variables;
  const middleware = [];
  if (visage_session !== 'off') middleware.push(session);
  if (visage_exchange !== 'off') middleware.push(exchange);
  return compose(...middleware)(request);
}
