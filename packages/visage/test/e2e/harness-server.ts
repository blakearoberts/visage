import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { Server } from 'node:net';

export type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void | Promise<void>;

export function createMiddlewareServer(): {
  readonly server: Server;
  use(middleware: Middleware): void;
} {
  const middlewares: Middleware[] = [];
  const server = createServer((request, response) => {
    let index = 0;
    const next = (error?: unknown): void => {
      if (error !== undefined) {
        console.error(error);
        response.statusCode = 500;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end('Internal Server Error');
        return;
      }

      const middleware = middlewares[index++];
      if (middleware === undefined) {
        response.statusCode = 404;
        response.end('Not Found');
        return;
      }

      try {
        const result = middleware(request, response, next);
        if (result instanceof Promise) result.catch(next);
      } catch (nextError) {
        next(nextError);
      }
    };

    next();
  });

  return {
    server,
    use(middleware) {
      middlewares.push(middleware);
    },
  };
}

export function prefixed(prefix: string, middleware: Middleware): Middleware {
  const slashless = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;

  return function prefixedMiddleware(request, response, next) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === slashless) {
      response.statusCode = 308;
      response.setHeader('Location', `${normalized}${url.search}`);
      response.end();
      return;
    }
    if (!url.pathname.startsWith(normalized)) {
      next();
      return;
    }

    const originalUrl = request.url;
    return middleware(request, response, (error) => {
      request.url = originalUrl;
      next(error);
    });
  };
}

export async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

export async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
