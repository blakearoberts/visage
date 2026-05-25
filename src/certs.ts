import { spawnSync, type StdioOptions } from 'node:child_process';
import { chmodSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { VisageConfig } from './config';

const CACHE_HOME = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');

export async function ensureCerts(config: VisageConfig): Promise<void> {
  const CAROOT = join(CACHE_HOME, 'visage/ca');
  mkdirSync(CAROOT, { recursive: true, mode: 0o700 });
  chmodSync(CAROOT, 0o700);

  const mkcert = resolveMkcert();

  const out = openSync(join(config.cache, 'logs', 'mkcert.log'), 'w');
  const env = { CAROOT, TRUST_STORES: 'system', ...process.env };
  const tty = process.stdin.isTTY;
  const stdio = [tty ? 'inherit' : 'ignore', out, out] satisfies StdioOptions;

  if (process.env.CI !== 'true') {
    // mkcert -install is idempotent;
    // CA files alone don't prove trust-store state.
    const result = spawnSync(mkcert, ['-install'], { env, stdio });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error('Failed to install CA');
    }
  }

  const certs = join(config.cache, config.files.certs[0]);
  const cert = join(certs, 'tls.crt');
  const key = join(certs, 'tls.key');

  mkdirSync(certs, { recursive: true, mode: 0o700 });
  chmodSync(certs, 0o700);
  rmSync(cert, { force: true });
  rmSync(key, { force: true });

  const names = [...new Set([config.host, 'localhost', '127.0.0.1', '::1'])];
  const args = ['-cert-file', cert, '-key-file', key, ...names];
  const result = spawnSync(mkcert, args, { env, stdio });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Failed to generate TLS certificates');
  }
  chmodSync(cert, 0o600);
  chmodSync(key, 0o600);
}

function resolveMkcert(): string {
  const env = process.env;
  const options = { encoding: 'utf8', env } as const;
  const mkcert = findMkcert();

  const result = spawnSync(mkcert, ['-version'], options);
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `Visage found mkcert at "${mkcert}", but could not execute it.`,
        '',
        mkcertInstallInstructions(),
      ].join('\n'),
    );
  }

  return mkcert;
}

function findMkcert(): string {
  const env = process.env;
  const exec = env.VISAGE_MKCERT || 'mkcert';
  const options = { encoding: 'utf8', env } as const;

  const result =
    process.platform === 'win32'
      ? spawnSync('where', [exec], options)
      : spawnSync('sh', ['-c', `command -v ${exec}`], options);

  const path = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (result.error || result.status !== 0 || !path) {
    throw new Error(
      [
        'Visage requires mkcert to configure HTTPS, but mkcert was not found.',
        '',
        mkcertInstallInstructions(),
      ].join('\n'),
    );
  }

  return path;
}

function mkcertInstallInstructions(): string {
  const common = [
    'After installing mkcert, run `mkcert -install` once when local ' +
      'certificates should be trusted.',
    'Install docs: https://github.com/FiloSottile/mkcert#installation',
    'Set VISAGE_MKCERT=/path/to/mkcert to use a custom executable.',
  ];
  const platform = process.platform;

  if (platform === 'darwin') {
    return [
      'Install mkcert with Homebrew:',
      '  brew install mkcert',
      '  brew install nss # optional, for Firefox',
      ...common,
    ].join('\n');
  }

  if (platform === 'win32') {
    return [
      'Install mkcert with Chocolatey or Scoop:',
      '  choco install mkcert',
      '  scoop install mkcert',
      ...common,
    ].join('\n');
  }

  if (platform === 'linux') {
    return [
      'Install mkcert with your Linux package manager. Common commands:',
      '  sudo apt install mkcert libnss3-tools',
      '  sudo dnf install mkcert nss-tools',
      '  sudo pacman -Syu mkcert nss',
      ...common,
    ].join('\n');
  }

  return [
    'Install mkcert for your operating system and make it available on PATH.',
    ...common,
  ].join('\n');
}
