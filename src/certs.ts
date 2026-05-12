import { spawnSync } from 'node:child_process';
import { chmodSync, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

type Options = {
  certs: string;
  hostname: string;
};

export async function ensureCerts({ certs, hostname }: Options): Promise<void> {
  const cert = join(certs, 'tls.crt');
  const key = join(certs, 'tls.key');
  if (existsSync(cert) && existsSync(key)) return;

  const mkcert = await ensureMkCert();
  const env = {
    ...process.env,
    CAROOT: join(
      process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
      'visage/ca',
    ),
    TRUST_STORES: process.env.TRUST_STORES ?? 'system',
  };

  mkdirSync(env.CAROOT, { recursive: true, mode: 0o700 });
  chmodSync(env.CAROOT, 0o700);

  // mkcert -install is idempotent; CA files alone do not prove trust-store state.
  {
    const result = spawnSync(mkcert, ['-install'], {
      env,
      stdio: [process.stdin.isTTY ? 'inherit' : 'ignore', 'inherit', 'inherit'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error('Failed to install CA');
    }
  }

  // generate certs
  mkdirSync(certs, { recursive: true });
  const names = [...new Set([hostname, 'localhost', '127.0.0.1', '::1'])];
  const args = ['-cert-file', cert, '-key-file', key, ...names];
  const result = spawnSync(mkcert, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Failed to generate TLS certificates');
  }
}

async function ensureMkCert(): Promise<string> {
  const bin = join(
    process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
    'visage/bin',
  );
  const file = join(bin, `mkcert-${process.platform}-${process.arch}`);
  if (existsSync(file)) return file;

  mkdirSync(bin, { recursive: true });

  const base = 'https://dl.filippo.io/mkcert/latest';
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const params = `?for=${process.platform}/${arch}`;
  const url = new URL(params, base);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error('Failed to download mkcert');
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
  chmodSync(file, 0o755);
  return file;
}
