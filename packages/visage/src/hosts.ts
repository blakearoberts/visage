import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

import type { VisageConfig } from './config';

const HOSTS_FILE = '/etc/hosts';

export function ensureHostEntry({ host }: VisageConfig): void {
  if (
    !host ||
    host.trim() !== host ||
    host.includes('/') ||
    host.includes(':')
  ) {
    throw new Error('Invalid hostname');
  }

  const contents = readFileSync(HOSTS_FILE, 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    const uncommented = line.replace(/\s+#.*$/, '').trim();
    if (!uncommented || uncommented.startsWith('#')) {
      continue;
    }

    const [address, ...names] = uncommented.split(/\s+/);
    if (!names.includes(host)) {
      continue;
    }

    if (address === '127.0.0.1' || address === '::1') {
      // Already configured to loopback, nothing to do.
      return;
    }

    throw new Error('Hosts file contains a conflicting entry');
  }

  const prefix = contents.endsWith('\n') ? '' : '\n';
  const entry = `${prefix}127.0.0.1\t${host} # visage\n`;

  try {
    appendFileSync(HOSTS_FILE, entry);
    return;
  } catch {
    // Fall through to sudo tee.
  }

  const result = spawnSync(
    'sudo',
    [...(process.stdin.isTTY ? [] : ['-n']), 'tee', '-a', HOSTS_FILE],
    {
      input: entry,
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error('Failed to add hosts entry');
  }
}
