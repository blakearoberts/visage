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

    config() {
      return {
        server: {
          // Configure Vite to only allow traffic from the intended host.
          allowedHosts: [resolvedOptions.host],
          hmr: {
            protocol: 'wss',
            host: resolvedOptions.host,
            clientPort: resolvedOptions.port,
          },
          // Overwrite the localhost default which may resolve to an IPv6
          // loopback. Docker Desktop (com.docker.backend), doesn't support IPv6
          // traffic translation to host loopback.
          host: '127.0.0.1',
        },
      };
    },

    configureServer(vite: ViteDevServer) {
      vite.middlewares.use(createVisageMiddleware(edgeKey));
      vite.httpServer?.prependListener(
        'upgrade',
        createVisageUpgradeHandler(edgeKey),
      );

      // Hide Vite's direct URL(s) because browser traffic must flow through the
      // browser-facing NGINX managed by Visage.
      let visageUrl: string | undefined;
      vite.printUrls = () => {
        vite.config.logger.info(visageUrl ?? 'Visage failed to start');
      };

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

        visageUrl = formatVisageUrlLog(config.host, config.port);

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

function formatVisageUrlLog(host: string, port: number): string {
  const AnsiGreen = '\x1b[32m';
  const AnsiCyan = '\x1b[36m';
  const AnsiBold = '\x1b[1m';
  const AnsiReset = '\x1b[0m';
  return `  ${AnsiGreen}➜${AnsiReset}  ${AnsiBold}Visage${AnsiReset}:  ${AnsiCyan}https://${host}:${AnsiBold}${port}${AnsiReset}${AnsiCyan}/${AnsiReset}`;
}
