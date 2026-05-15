import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

import { ensureCerts } from './certs';
import { startCompose } from './compose';
import { resolveConfig, resolveOptions, resolveViteUpstream } from './config';
import { ensureHostEntry } from './hosts';
import { render } from './render';
import type { VisageOptions, VisageServer, VisageUpstream } from './types';

export type {
  VisageCookiePolicy,
  VisageDexExpiry,
  VisageDexOptions,
  VisageDexUser,
  VisageExternalIdpOptions,
  VisageOAuth2Client,
  VisageOptions,
  VisageProxyPolicy,
  VisageServer,
  VisageService,
  VisageUpstream,
} from './types';

export function createVisageServer(options: VisageOptions): VisageServer {
  const config = resolveConfig(
    resolveOptions({
      ...options,
      upstreams: {
        ...options.upstreams,
        vite: resolveViteUpstream(options.upstreams?.vite),
      },
    }),
    join(process.cwd(), '.visage'),
  );
  let stop: (() => void) | undefined;
  return {
    async listen() {
      if (stop) return;

      rmSync(join(config.cache, 'logs'), { recursive: true, force: true });

      await ensureCerts({
        certs: join(config.cache, config.files.certs[0]),
        hostname: config.host,
      });
      ensureHostEntry(config.host);

      render(config);
      stop = await startCompose(join(config.cache, config.files.compose));
    },
    close() {
      stop?.();
      stop = undefined;
    },
  };
}

export default function visage(options: VisageOptions = {}): Plugin {
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

      async function startVisage(vite: VisageUpstream) {
        const config = resolveConfig(
          resolveOptions({
            ...options,
            upstreams: { ...options.upstreams, vite },
          }),
          join(viteDevServer.config.cacheDir, 'visage'),
        );
        visageUrl = formatVisageUrlLog(config.host, config.port);

        rmSync(join(config.cache, 'logs'), { recursive: true, force: true });

        await ensureCerts({
          certs: join(config.cache, config.files.certs[0]),
          hostname: config.host,
        });
        ensureHostEntry(config.host);

        render(config);
        return startCompose(join(config.cache, config.files.compose));
      }

      // monkey patch vite's listen to get vite's auto-resolved port
      const listen = viteDevServer.listen.bind(viteDevServer);
      viteDevServer.listen = async (port, isRestart) => {
        const result = await listen(port, isRestart);
        const address = viteDevServer.httpServer?.address();
        if (!address || typeof address === 'string') {
          throw new Error('Failed to resolve port for Visage');
        }
        const vite = resolveViteUpstream({
          port: address.port,
          ...options.upstreams?.vite,
        });
        stop = await startVisage(vite);
        viteDevServer.httpServer?.once('close', closeBundle);
        return result;
      };
    },

    closeBundle,
  };
}

function formatVisageUrlLog(host: string, port: number): string {
  const AnsiGreen = '\x1b[32m';
  const AnsiCyan = '\x1b[36m';
  const AnsiBold = '\x1b[1m';
  const AnsiReset = '\x1b[0m';
  return `  ${AnsiGreen}➜${AnsiReset}  ${AnsiBold}Visage${AnsiReset}:  ${AnsiCyan}https://${host}:${AnsiBold}${port}${AnsiReset}${AnsiCyan}/${AnsiReset}`;
}
