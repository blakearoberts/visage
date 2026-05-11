import type { VisageConfig } from '../config';
import { writeComposeConfig } from './compose';
import { writeDexConfig } from './dex';
import { writeNginxConfig } from './nginx';
import { writeOauth2ProxyConfig } from './oauth2-proxy';

export function render(config: VisageConfig): void {
  writeComposeConfig(config);
  if (config.idp.kind === 'dex') {
    writeDexConfig(config);
  }
  writeNginxConfig(config);
  writeOauth2ProxyConfig(config);
}
