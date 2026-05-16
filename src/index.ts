import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

import { ensureCerts } from './certs';
import { startCompose } from './compose';
import {
  resolveConfig,
  resolveOptions,
  resolveViteUpstream,
  type VisageConfig,
} from './config';
import { ensureHostEntry } from './hosts';
import {
  writeComposeConfig,
  writeDexConfig,
  writeNginxConfig,
  writeOauth2ProxyConfig,
} from './render';
import type { VisageOptions, VisageServer } from './types';

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
      stop = await startVisageServer(config);
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

      // monkey patch vite's listen to get vite's auto-resolved port
      const listen = viteDevServer.listen.bind(viteDevServer);
      viteDevServer.listen = async (port, isRestart) => {
        const result = await listen(port, isRestart);
        const address = viteDevServer.httpServer?.address();
        if (!address || typeof address === 'string') {
          throw new Error('Failed to resolve port for Visage');
        }

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
          join(viteDevServer.config.cacheDir, 'visage'),
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

async function startVisageServer(config: VisageConfig) {
  const logs = join(config.cache, 'logs');
  rmSync(logs, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true });

  await ensureCerts(config);
  ensureHostEntry(config);

  writeComposeConfig(config);
  if ('dex' in config.idp) {
    writeDexConfig(config);
  }
  writeNginxConfig(config);
  writeOauth2ProxyConfig(config);

  return startCompose(config);
}

function formatVisageUrlLog(host: string, port: number): string {
  const AnsiGreen = '\x1b[32m';
  const AnsiCyan = '\x1b[36m';
  const AnsiBold = '\x1b[1m';
  const AnsiReset = '\x1b[0m';
  return `  ${AnsiGreen}➜${AnsiReset}  ${AnsiBold}Visage${AnsiReset}:  ${AnsiCyan}https://${host}:${AnsiBold}${port}${AnsiReset}${AnsiCyan}/${AnsiReset}`;
}
