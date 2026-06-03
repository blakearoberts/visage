import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';

import { ensureCerts } from './certs';
import { startCompose } from './compose';
import { resolveConfig, resolveOptions, type VisageConfig } from './config';
import { ensureHostEntry } from './hosts';
import {
  createVisageMiddleware,
  createVisageUpgradeHandler,
} from './middleware';
import { ensureNginxNetwork } from './network';
import {
  writeComposeConfig,
  writeDexConfig,
  writeNginxConfig,
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
   * Reject requests that did not pass through the Visage-managed NGINX edge.
   */
  middleware: VisageMiddleware;
  /**
   * Reject upgrade requests that did not pass through the Visage-managed NGINX
   * edge.
   */
  upgrade: VisageUpgradeHandler;
  /**
   * Start the Visage managed services (NGINX, OAuth2 Proxy, and sometimes Dex).
   */
  listen(): Promise<void>;
  /**
   * Stop the Visage managed services.
   */
  close(): void;
};

export function createVisageServer(options: VisageOptions): VisageServer {
  const root = process.cwd();
  const edgeKey = randomBytes(32).toString('base64url');
  const config = resolveConfig({
    ...resolveOptions(options),
    root,
    cache: join(root, '.visage'),
    edgeKey,
  });
  let stop: (() => void) | undefined;
  return {
    middleware: createVisageMiddleware(edgeKey),
    upgrade: createVisageUpgradeHandler(edgeKey),
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
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  chmodSync(logs, 0o700);

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
