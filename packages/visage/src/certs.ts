import { spawnSync, type StdioOptions } from 'node:child_process';
import { chmodSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { VisageConfig } from './config';

export async function ensureCerts(config: VisageConfig): Promise<void> {
  const mkcert = resolveMkcert();

  const out = openSync(join(config.cache, 'logs', 'mkcert.log'), 'w');
  const tty = process.stdin.isTTY;
  const stdio = [tty ? 'inherit' : 'ignore', out, out] satisfies StdioOptions;

  {
    // mkcert -install is idempotent;
    // CA files alone don't prove trust-store state.
    const result = spawnSync(mkcert, ['-install'], { stdio });
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
  const result = spawnSync(mkcert, args, { stdio });
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
      ['mkcert not found', '', mkcertInstallInstructions()].join('\n'),
    );
  }

  return path;
}

function mkcertInstallInstructions(): string {
  let install: string[];
  switch (process.platform) {
    case 'darwin':
      install = ['Install mkcert with Homebrew:', '  brew install mkcert'];
      break;
    case 'win32':
      install = [
        'Install mkcert with Chocolatey or Scoop:',
        '  choco install mkcert',
        '  scoop install mkcert',
      ];
      break;
    case 'linux':
      install = [
        'Install mkcert with your Linux package manager. Common commands:',
        '  sudo apt install mkcert libnss3-tools',
        '  sudo dnf install mkcert nss-tools',
        '  sudo pacman -Syu mkcert nss',
      ];
      break;
    default:
      install = [
        'Install mkcert for your operating system and make it available on PATH.',
      ];
      break;
  }

  return [
    'Visage requires mkcert to configure HTTPS.',
    '',
    ...install,
    '',
    'See https://github.com/FiloSottile/mkcert#installation for more information.',
  ].join('\n');
}
