import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const e2eCache =
  process.env.VISAGE_E2E_XDG_CACHE_HOME ??
  (process.env.CI === 'true'
    ? join(repo, 'test-results/xdg-cache')
    : undefined);

export function e2eEnv(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(e2eCache === undefined ? {} : { XDG_CACHE_HOME: e2eCache }),
    ...env,
  };
}
