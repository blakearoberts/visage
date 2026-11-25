import { exchange } from './exchange.ts';
import { session } from './session.ts';
import { sign_out } from './sign-out.ts';
import { use } from './use.ts';

export type { Context, Credential, Middleware } from './types.ts';
export { exchange, session, sign_out, use };

export default Object.assign(
  function js_access(request: NginxHTTPRequest) {
    const { visage_session, visage_exchange } = request.variables;
    const middleware = [];
    if (visage_session !== 'off') middleware.push(session);
    if (visage_exchange !== 'off') middleware.push(exchange);
    return use(...middleware)(request);
  },
  {
    session: use(session),
    exchange: use(session, exchange),
    sign_out: use(session, sign_out),
  },
);
