import { createVisageServer } from '@blakearoberts/visage';
import connect from 'connect';
import { createServer as createViteServer } from 'vite';

import { createSessionCacheMiddleware } from './sessioncache/server';

const appPort = 6176;
const visagePort = 9004;

const app = connect();
const server = app.listen(appPort);

const visage = createVisageServer({
  port: visagePort,
  services: {
    blob: {
      image: 'traefik/whoami',
      upstream: {
        locations: {
          '/blob/': { headers: { 'X-Auth-Request-Email': '$auth_email' } },
        },
      },
    },
  },
  upstreams: { vite: { port: appPort } },
});
await visage.listen();

const vite = await createViteServer({
  appType: 'spa',
  server: { middlewareMode: true, ws: { server } },
});

server.prependListener('upgrade', visage.upgrade);
app.use(visage.middleware);
app.use(createSessionCacheMiddleware());
app.use(vite.middlewares);

function close() {
  vite.close();
  visage.close();
  server.close();
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
