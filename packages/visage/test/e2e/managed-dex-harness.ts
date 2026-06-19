import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

import { createServer as createViteServer, type ViteDevServer } from 'vite';

import {
  appLocationPolicy,
  managedDexPort,
  packageEntrySpecifier,
  repo,
  sharedDirectPort,
  simpleDexUser,
  ssrDexUser,
} from './harness';
import {
  closeServer,
  createMiddlewareServer,
  listen,
  prefixed,
  type Middleware,
} from './harness-server';

const { createVisageServer } = (await import(
  packageEntrySpecifier()
)) as typeof import('../../src/index');

const simpleRoot = join(repo, 'examples/simple');
const ssrRoot = join(repo, 'examples/ssr');

const { server, use } = createMiddlewareServer();
const visage = createVisageServer({
  port: managedDexPort,
  idp: { users: [simpleDexUser, ssrDexUser] },
  services: { whoami: { image: 'traefik/whoami' } },
  upstreams: {
    vite: {
      port: sharedDirectPort,
      locations: {
        '/simple/': appLocationPolicy,
        '/ssr/': appLocationPolicy,
      },
    },
  },
});

let simpleVite: ViteDevServer | undefined;
let ssrVite: ViteDevServer | undefined;

try {
  simpleVite = await createViteServer({
    root: simpleRoot,
    base: '/simple/',
    configFile: false,
    appType: 'spa',
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  ssrVite = await createViteServer({
    root: ssrRoot,
    base: '/ssr/',
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
  });

  server.prependListener('upgrade', visage.upgrade);
  use(visage.middleware);
  use(prefixed('/simple/', simpleVite.middlewares as Middleware));
  use(prefixed('/ssr/', ssrVite.middlewares as Middleware));
  use(prefixed('/ssr/', ssrHandler(ssrVite)));

  await listen(server, sharedDirectPort);
  await visage.listen();
  console.log(`Managed Dex harness listening on ${managedDexPort}`);
  await waitForShutdown();
} catch (error) {
  await shutdown();
  throw error;
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    const handle = () => {
      shutdown().then(resolve, (error: unknown) => {
        console.error(error);
        resolve();
      });
    };
    process.once('SIGINT', handle);
    process.once('SIGTERM', handle);
  });
}

async function shutdown(): Promise<void> {
  visage.close();
  await simpleVite?.close();
  await ssrVite?.close();
  await closeServer(server);
}

function ssrHandler(vite: ViteDevServer): Middleware {
  return async function handleSsr(request, response, next) {
    if (!acceptsHtml(request)) {
      next();
      return;
    }

    try {
      const identity = {
        user: getHeader(request, 'x-auth-request-user'),
        email: getHeader(request, 'x-auth-request-email'),
      };
      const { render } = (await vite.ssrLoadModule(
        '/src/entry-server.tsx',
      )) as { render(identity: Record<string, unknown>): string };
      const index = join(ssrRoot, 'index.html');
      const template = await readFile(index, 'utf8');
      const html = (
        await vite.transformIndexHtml(request.url ?? '/ssr/', template)
      )
        .replace('<!--ssr-identity-->', renderIdentity(identity))
        .replace('<!--ssr-outlet-->', render(identity));

      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(html);
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      next(error);
    }
  };
}

function acceptsHtml(request: IncomingMessage): boolean {
  const accept = String(request.headers.accept ?? '');
  return (
    accept === '' || accept.includes('text/html') || accept.includes('*/*')
  );
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function renderIdentity(identity: Record<string, unknown>): string {
  return JSON.stringify(identity).replace(/</g, '\\u003c');
}
