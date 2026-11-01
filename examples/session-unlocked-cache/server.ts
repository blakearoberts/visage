import { createVisageServer } from '@blakearoberts/visage';
import connect from 'connect';
import { createServer as createViteServer } from 'vite';

import { createSessionCacheMiddleware } from './sessioncache/server';

const app = connect();
const server = app.listen(6176);

const visage = createVisageServer({
  port: 9004,
  services: { blob: { image: 'traefik/whoami' } },
});
await visage.listen(server);

const vite = await createViteServer({
  appType: 'spa',
  server: { middlewareMode: true, ws: { server } },
});

server.prependListener('upgrade', visage.upgrade);
app.use(visage.middleware);
app.use(createSessionCacheMiddleware());
app.use(vite.middlewares);

async function shutdown() {
  await vite.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  visage.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
