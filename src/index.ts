import { join } from 'node:path';
import type { Plugin } from 'vite';

import { startCompose } from './compose';
import { ensureCerts } from './certs';
import { ensureHostEntry } from './hosts';
import { render } from './render';
import { resolveConfig, resolveOptions } from './config';
import type { VisageOptions } from './types';

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

export function visage(options: VisageOptions = {}): Plugin {
  const resolvedOptions = resolveOptions(options);
  let stop: (() => void) | undefined;

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
      async function startVisage(port: number) {
        const config = resolveConfig(resolvedOptions, server.config, port);
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
        return result;
      };
    },

    closeBundle() {
      stop?.();
      stop = undefined;
    },
  };
}

export default visage;
