import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server, Socket } from 'node:net';
import { join } from 'node:path';

import { ensureCerts } from './certs';
import { startCompose } from './compose';
import { resolveConfig, resolveOptions, type VisageConfig } from './config';
import { ensureHostEntry } from './hosts';
import {
  createVisageMiddleware,
  createVisageUpgradeHandler,
} from './middleware';
import {
  writeComposeConfig,
  writeDexConfig,
  writeNginxAssets,
  writeOauth2ProxyConfig,
} from './render';
import type { VisageOptions } from './types';

export type VisageMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void;

export type VisageUpgradeHandler = (
  request: IncomingMessage,
  socket: Socket,
) => void;

/**
 * A running Visage instance.
 */
export type VisageServer = {
  /**
   * Accept requests that passed through Visage; reject others.
   */
  middleware: VisageMiddleware;
  /**
   * Accept upgrade requests that passed through Visage; reject others.
   */
  upgrade: VisageUpgradeHandler;
  /**
   * Start Visage managed services.
   */
  listen(server: Server): Promise<void>;
  /**
   * Stop Visage managed services.
   */
  close(): void;
};

export function createVisageServer(options: VisageOptions): VisageServer {
  const resolvedOptions = resolveOptions(options);
  const edgeKey = randomBytes(32).toString('base64url');
  let stop: (() => void) | undefined;
  return {
    middleware: createVisageMiddleware(edgeKey),
    upgrade: createVisageUpgradeHandler(edgeKey),
    async listen(server) {
      if (!server.listening) await once(server, 'listening');

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve port');
      }

      const root = process.cwd();
      const config = resolveConfig({
        ...resolvedOptions,
        appPort: address.port,
        root,
        cache: join(root, '.visage'),
        edgeKey,
      });
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
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  chmodSync(logs, 0o700);

  await ensureCerts(config);
  await ensureHostEntry(config);

  writeComposeConfig(config);
  if (config.dex !== undefined) {
    writeDexConfig(config);
  }
  writeNginxAssets(config);
  writeOauth2ProxyConfig(config);

  return startCompose(config);
}
