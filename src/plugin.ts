import { join } from 'node:path';
import type { Plugin } from 'vite';

import { resolveConfig, resolveOptions, resolveViteUpstream } from './config';
import { startVisageServer } from './server';
import type { VisageOptions } from './types';

export function visage(options: VisageOptions = {}): Plugin {
  const resolvedOptions = resolveOptions(options);
  let stop: (() => void) | undefined;
  const closeBundle = () => {
    stop?.();
    stop = undefined;
  };

  return {
    name: 'visage',
    apply: 'serve',

    config() {
      return {
        server: {
          hmr: {
            protocol: 'wss',
            host: resolvedOptions.host,
            clientPort: resolvedOptions.port,
          },
          host: '0.0.0.0',
        },
      };
    },

    configureServer(viteDevServer) {
      // monkey patch vite's list of urls to include visage
      let visageUrl: string | undefined;
      const printUrls = viteDevServer.printUrls.bind(viteDevServer);
      viteDevServer.printUrls = () => {
        printUrls();
        viteDevServer.config.logger.info(visageUrl ?? 'Visage failed to start');
      };

      // monkey patch vite's listen to get vite's auto-resolved port
      const listen = viteDevServer.listen.bind(viteDevServer);
      viteDevServer.listen = async (port, isRestart) => {
        const result = await listen(port, isRestart);
        const address = viteDevServer.httpServer?.address();
        if (!address || typeof address === 'string') {
          throw new Error('Failed to resolve port for Visage');
        }

        const cache = join(viteDevServer.config.cacheDir, 'visage');
        const config = resolveConfig(
          resolveOptions({
            ...options,
            upstreams: {
              ...options.upstreams,
              vite: resolveViteUpstream({
                port: address.port,
                ...options.upstreams?.vite,
              }),
            },
          }),
          cache,
        );

        visageUrl = formatVisageUrlLog(config.host, config.port);

        stop = await startVisageServer(config);
        viteDevServer.httpServer?.once('close', closeBundle);
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
