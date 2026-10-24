import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

import { resolveConfig, resolveOptions } from './config';
import {
  createVisageMiddleware,
  createVisageUpgradeHandler,
} from './middleware';
import { startVisageServer } from './server';
import type { VisageOptions } from './types';

export function visage(options: VisageOptions = {}): Plugin {
  const resolvedOptions = resolveOptions(options);
  let stop: (() => void) | undefined;
  const closeBundle = () => {
    stop?.();
    stop = undefined;
  };

  const edgeKey = randomBytes(32).toString('base64url');

  return {
    name: 'visage',
    apply: 'serve',

    config(config) {
      return {
        server: {
          // Configure Vite to only allow traffic from the intended host.
          allowedHosts: [resolvedOptions.host],
          // Overwrite the localhost default which may resolve to an IPv6
          // loopback. Docker Desktop (com.docker.backend), doesn't support IPv6
          // traffic translation to host loopback.
          host: '127.0.0.1',
          // Overwrite WebSocket configuration to use SSL unless WebSockets
          // have been disabled.
          ...(config.server?.ws !== false
            ? {
                ws: {
                  protocol: 'wss',
                  host: resolvedOptions.host,
                  clientPort: resolvedOptions.port,
                },
              }
            : {}),
        },
      };
    },

    configureServer(vite: ViteDevServer) {
      vite.middlewares.use(createVisageMiddleware(edgeKey));
      vite.httpServer?.prependListener(
        'upgrade',
        createVisageUpgradeHandler(edgeKey),
      );

      // Monkey patch Vite's listen to get the server's auto-resolved port.
      const listen = vite.listen.bind(vite);
      vite.listen = async (port, isRestart) => {
        const result = await listen(port, isRestart);
        const address = vite.httpServer?.address();
        if (!address || typeof address === 'string') {
          throw new Error('Failed to resolve port for Visage');
        }

        const config = resolveConfig({
          ...resolveOptions({
            ...options,
            upstreams: {
              ...options.upstreams,
              vite: { port: address.port, ...options.upstreams?.vite },
            },
          }),
          root: vite.config.root,
          cache: join(vite.config.cacheDir, 'visage'),
          edgeKey,
        });
        vite.resolvedUrls = {
          local: [`https://${config.host}:${config.port}/`],
          network: [],
        };

        stop = await startVisageServer(config);
        process.once('SIGINT', closeBundle);
        vite.httpServer?.once('close', closeBundle);
        return result;
      };
    },

    closeBundle,
  };
}

export default visage;
