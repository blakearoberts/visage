import type { Plugin, ViteDevServer } from 'vite';

import {
  formatComposeStatus,
  getComposeStatus,
  withComposeStatus,
} from './compose.ts';
import { resolveConfig, resolveOptions } from './config.ts';
import {
  createVisageMiddleware,
  createVisageUpgradeHandler,
} from './middleware.ts';
import { startVisageServer } from './server.ts';
import type { VisageOptions } from './types.ts';

export function visage(options: VisageOptions = {}): Plugin {
  const { host = 'localhost', port: clientPort = 9001 } = options;
  let stop: (() => Promise<void>) | undefined;
  const closeBundle = () => {
    const result = stop?.();
    stop = undefined;
    return result?.finally(() => process.off('SIGINT', closeBundle));
  };

  return {
    name: 'visage',
    apply: 'serve',

    config(config) {
      return {
        server: {
          // Configure Vite to only allow traffic from the intended host.
          allowedHosts: [host],
          // Overwrite the localhost default which may resolve to an IPv6
          // loopback. Docker Desktop (com.docker.backend), doesn't support IPv6
          // traffic translation to host loopback.
          host: '127.0.0.1',
          // Overwrite WebSocket configuration to use SSL unless WebSockets
          // have been disabled.
          ...(config.server?.ws !== false
            ? { ws: { protocol: 'wss', host, clientPort } }
            : {}),
        },
      };
    },

    configureServer(vite: ViteDevServer) {
      const resolvedOptions = resolveOptions({
        ...options,
        dir: options.dir ?? vite.config.root,
      });
      const edgeKey = resolvedOptions.secrets.VISAGE_EDGE_KEY;
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
          ...resolvedOptions,
          appPort: address.port,
        });
        vite.resolvedUrls = {
          local: [`https://${config.app.host}:${config.app.port}/`],
          network: [],
        };

        stop = withComposeStatus(
          config,
          await startVisageServer(config),
          vite.config,
        );
        vite.bindCLIShortcuts({
          customShortcuts: [
            {
              key: 's',
              description: 'show compose status',
              action: () =>
                getComposeStatus(config)
                  .then(formatComposeStatus)
                  .then(vite.config.logger.info),
            },
          ],
        });
        process.on('SIGINT', closeBundle);
        return result;
      };
    },

    closeBundle,
  };
}

export default visage;
