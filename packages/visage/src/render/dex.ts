import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync, truncates } from 'bcryptjs';
import { stringify } from 'yaml';

import type { VisageConfig } from '../config';

export function writeDexConfig(config: VisageConfig): void {
  if (config.dex === undefined) throw new Error('Dex config missing');
  const render = renderDexConfig(config);
  const file = join(config.cache, config.files.dex);
  writeFileSync(file, render, 'utf-8');
}

/** @internal Exported for unit testing. */
export function validateDexPassword(password: string): void {
  const length = [...password].length; // Unicode length
  if (length < 15 || length > 64) {
    throw new Error('Password must be between 15 and 64 characters');
  }
  if (truncates(password)) {
    throw new Error('Password must not exceed 72 UTF-8 bytes');
  }
}

function renderDexConfig(config: VisageConfig): string {
  const { users, ...dex } = config.dex!;
  return stringify({
    ...dex,
    staticPasswords: users.map(({ password, ...user }) => {
      validateDexPassword(password);
      return { ...user, hash: hashSync(password) };
    }),
  });
}
