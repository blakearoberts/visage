import { spawnSync, type StdioOptions } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

type Options = {
  certs: string;
  hostname: string;
};

const CACHE_HOME = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');

export async function ensureCerts({ certs, hostname }: Options): Promise<void> {
  const CAROOT = join(CACHE_HOME, 'visage/ca');
  mkdirSync(CAROOT, { recursive: true, mode: 0o700 });
  chmodSync(CAROOT, 0o700);

  const mkcert = await ensureMkCert();
  const logs = join(dirname(certs), 'logs');
  mkdirSync(logs, { recursive: true });
  const log = join(logs, 'mkcert.log');
  const output = openSync(log, 'w');

  const env = { CAROOT, TRUST_STORES: 'system', ...process.env };
  const tty = process.stdin.isTTY;
  const stdio = [
    tty ? 'inherit' : 'ignore',
    output,
    output,
  ] satisfies StdioOptions;

  if (process.env.CI !== 'true') {
    // mkcert -install is idempotent; CA files alone do not prove trust-store state.
    const result = spawnSync(mkcert, ['-install'], { env, stdio });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error('Failed to install CA');
    }
  }

  const cert = join(certs, 'tls.crt');
  const key = join(certs, 'tls.key');

  mkdirSync(certs, { recursive: true });
  rmSync(cert, { force: true });
  rmSync(key, { force: true });

  const names = [...new Set([hostname, 'localhost', '127.0.0.1', '::1'])];
  const args = ['-cert-file', cert, '-key-file', key, ...names];
  const result = spawnSync(mkcert, args, { env, stdio });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Failed to generate TLS certificates');
  }
}

async function ensureMkCert(): Promise<string> {
  const bin = join(CACHE_HOME, 'visage/bin');
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
