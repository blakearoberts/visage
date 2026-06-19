import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { VisageProxyPolicy } from '../../src/types';
import { repo } from './environment';

export { repo };

export const harnessRoot = join(repo, 'test-results/e2e-harness');
export const manifestFile = join(harnessRoot, 'manifest.json');

export const managedDexPort = 9001;
export const externalIdpPort = 9002;
export const sharedDirectPort = 6173;
export const externalIdpDirectPort = 6174;

export const dexPassword = 'pass';
export type DexCredentials = {
  readonly email: string;
  readonly password: string;
};
export const simpleDexUser = {
  email: 'simple@example.com',
  password: dexPassword,
} satisfies DexCredentials;
export const ssrDexUser = {
  email: 'ssr@example.com',
  password: dexPassword,
} satisfies DexCredentials;
export const externalIdpUser = {
  email: 'user@example.com',
  password: dexPassword,
} satisfies DexCredentials;

export const appLocationPolicy = {
  auth: { enabled: true, forward: false, redirect: true },
  csrf: 'app',
  headers: {
    Host: '$host',
    Upgrade: '$http_upgrade',
    Connection: '$connection_upgrade',
    'X-Auth-Request-User': '$auth_user',
    'X-Auth-Request-Email': '$auth_email',
  },
  directives: {
    proxy_http_version: '1.1',
    proxy_read_timeout: '1h',
  },
} satisfies VisageProxyPolicy;

export type HarnessApp = {
  readonly appUrl: string;
  readonly directUrl?: string;
};

export type HarnessManifest = {
  readonly simple: HarnessApp & { readonly directUrl: string };
  readonly ssr: HarnessApp & { readonly directUrl: string };
  readonly externalIdp: HarnessApp & { readonly directUrl: string };
};

export function readHarnessManifest(): HarnessManifest {
  return JSON.parse(readFileSync(manifestFile, 'utf8')) as HarnessManifest;
}

export function packageEntrySpecifier(): string {
  const entry = process.env.VISAGE_E2E_PACKAGE_ENTRY;
  if (entry === undefined) return '@blakearoberts/visage';
  if (/^[a-z][a-z\d+.-]*:/i.test(entry)) return entry;
  return pathToFileURL(entry).href;
}
