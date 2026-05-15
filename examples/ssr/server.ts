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
  upstreams: {
    vite: {
      port,
      locations: {
        '/': {
          headers: {
            'X-Auth-Request-User': '$auth_user',
            'X-Auth-Request-Email': '$auth_email',
          },
        },
      },
    },
  },
});
await visage.listen();

process.once('SIGINT', () => {
  visage.close();
  server.close();
});

function ssrHandler(vite: ViteDevServer): connect.SimpleHandleFunction {
  return async function ssr(req, res) {
    try {
      const identity = {
        user: req.headers['x-auth-request-user'],
        email: req.headers['x-auth-request-email'],
      };
      const template = await readFile(
        new URL('index.html', import.meta.url),
        'utf8',
      );
      const { render } = (await vite.ssrLoadModule(
        '/src/entry-server.tsx',
      )) as typeof import('./src/entry-server');
      const html = (await vite.transformIndexHtml(req.url ?? '/', template))
        .replace(
          `<!--ssr-identity-->`,
          JSON.stringify(identity).replace(/</g, '\\u003c'),
        )
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
