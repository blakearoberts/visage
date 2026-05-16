import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureCerts } from './certs';
import { startCompose } from './compose';
import {
  resolveConfig,
  resolveOptions,
  resolveViteUpstream,
  type VisageConfig,
} from './config';
import { ensureHostEntry } from './hosts';
import { ensureNginxNetwork } from './network';
import {
  writeComposeConfig,
  writeDexConfig,
  writeNginxConfig,
  writeOauth2ProxyConfig,
} from './render';
import type { VisageOptions, VisageServer } from './types';

export function createVisageServer(options: VisageOptions): VisageServer {
  const cache = join(process.cwd(), '.visage');
  const config = resolveConfig(
    resolveOptions({
      ...options,
      upstreams: {
        ...options.upstreams,
        vite: resolveViteUpstream(options.upstreams?.vite),
      },
    }),
    cache,
  );
  let stop: (() => void) | undefined;
  return {
    async listen() {
      stop ??= await startVisageServer(config);
    },
    close() {
      stop?.();
      stop = undefined;
    },
  };
}

export async function startVisageServer(
  config: VisageConfig,
): Promise<() => void> {
  const logs = join(config.cache, 'logs');
  rmSync(logs, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true });

  await ensureCerts(config);
  ensureHostEntry(config);

  const renderConfig = ensureNginxNetwork(config);

  writeComposeConfig(renderConfig);
  if ('dex' in renderConfig.idp) {
    writeDexConfig(renderConfig);
  }
  writeNginxConfig(renderConfig);
  writeOauth2ProxyConfig(renderConfig);

  return startCompose(renderConfig);
}
