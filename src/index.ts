import { join } from 'node:path';
import type { Plugin } from 'vite';

import { startCompose } from './compose';
import { ensureCerts } from './certs';
import { ensureHostEntry } from './hosts';
import { render } from './render';
import { resolveConfig, resolveOptions } from './config';
import type { VisageOptions } from './types';
import { rmSync } from 'node:fs';

export type {
  VisageCookiePolicy,
  VisageDexExpiry,
  VisageDexOptions,
  VisageDexUser,
  VisageExternalIdpOptions,
  VisageOAuth2Client,
  VisageOptions,
  VisageProxyPolicy,
  VisageService,
  VisageUpstream,
} from './types';

function formatUrl(host: string, port: number): string {
  const AnsiGreen = '\x1b[32m';
  const AnsiCyan = '\x1b[36m';
  const AnsiBold = '\x1b[1m';
  const AnsiReset = '\x1b[0m';
  return `  ${AnsiGreen}➜${AnsiReset}  ${AnsiBold}Visage${AnsiReset}:  ${AnsiCyan}https://${host}:${AnsiBold}${port}${AnsiReset}${AnsiCyan}/${AnsiReset}`;
}

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

    configureServer(server) {
      let url: { host: string; port: number } | undefined;
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printUrls();
        if (url) server.config.logger.info(formatUrl(url.host, url.port));
      };

      async function startVisage(port: number) {
        const config = resolveConfig(resolvedOptions, server.config, port);
        url = { host: config.host, port: config.port };

        rmSync(join(config.cache, 'logs'), { recursive: true, force: true });

        await ensureCerts({
          certs: join(config.cache, config.files.certs[0]),
          hostname: config.host,
        });
        ensureHostEntry(config.host);

        render(config);
        return startCompose(join(config.cache, config.files.compose));
      }

      const listen = server.listen.bind(server);
      server.listen = async (port, isRestart) => {
        const result = await listen(port, isRestart);
        const address = server.httpServer?.address();
        if (!address || typeof address === 'string') {
          throw new Error('Failed to resolve port for Visage');
        }
        stop = await startVisage(address.port);
        server.httpServer?.once('close', closeBundle);
        return result;
      };
    },

    closeBundle,
  };
}

export default visage;
