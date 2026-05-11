import { spawnSync } from 'node:child_process';
import { chmodSync, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

type Options = {
  bin: string;
  certs: string;
  hostname: string;
};

export async function ensureCerts({
  bin,
  certs,
  hostname,
}: Options): Promise<void> {
  const cert = join(certs, 'tls.crt');
  const key = join(certs, 'tls.key');
  if (existsSync(cert) && existsSync(key)) return;

  const mkcert = await ensureMkCert(bin);

  // install CA
  {
    const result = spawnSync(mkcert, ['-install'], {
      env: {
        ...process.env,
        TRUST_STORES: process.env.TRUST_STORES ?? 'system',
      },
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
  const result = spawnSync(mkcert, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Failed to generate TLS certificates');
  }
}

async function ensureMkCert(bin: string): Promise<string> {
  const file = join(bin, 'mkcert');
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
