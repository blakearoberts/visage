import type { VisageConfig } from '../config';
import { writeComposeConfig } from './compose';
import { writeDexConfig } from './dex';
import { writeNginxConfig } from './nginx';
import { writeOauth2ProxyConfig } from './oauth2-proxy';

export function render(config: VisageConfig): void {
  writeComposeConfig(config);
  if ('dex' in config.idp) {
    writeDexConfig(config);
  }
  writeNginxConfig(config);
  writeOauth2ProxyConfig(config);
}
