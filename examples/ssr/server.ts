import { readFile } from 'node:fs/promises';

import { createVisageServer } from '@blakearoberts/visage';
import connect from 'connect';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const port = 8080;
const app = connect();
const server = app.listen(port);

const vite = await createViteServer({
  server: { middlewareMode: true, hmr: { server } },
  appType: 'custom',
});
app.use(vite.middlewares);
app.use(ssrHandler(vite));

const visage = createVisageServer({
  port: 9003,
  services: { whoami: { image: 'traefik/whoami' } },
  upstreams: { vite: { port } },
});
await visage.listen();

process.once('SIGINT', () => {
  visage.close();
  server.close();
});

function ssrHandler(vite: ViteDevServer): connect.SimpleHandleFunction {
  return async function ssr(req, res) {
    try {
      // parse identity headers
      const identity = {
        user: getHeader(req, 'x-auth-request-user'),
        email: getHeader(req, 'x-auth-request-email'),
      } satisfies Identity;

      // load app module
      type Module = typeof import('./src/entry-server');
      const { render } = (await vite.ssrLoadModule(
        '/src/entry-server.tsx',
      )) as Module;

      // read index template
      const index = new URL('index.html', import.meta.url);
      const template = await readFile(index, 'utf8');

      // transform index, inject identity and render app
      const html = (await vite.transformIndexHtml(req.url ?? '/', template))
        .replace(`<!--ssr-identity-->`, renderIdentity(identity))
        .replace('<!--ssr-outlet-->', render(identity));

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  };
}

function getHeader(
  req: connect.IncomingMessage,
  name: string,
): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

type Identity = { readonly user?: string; readonly email?: string };

function renderIdentity(identity: Identity) {
  return JSON.stringify(identity).replace(/</g, '\\u003c');
}
