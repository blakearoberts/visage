import { spawnSync } from 'node:child_process';

import type { VisageConfig } from './config';

export function ensureNginxNetwork(config: VisageConfig): VisageConfig {
  const network = config.compose.name;
  const exists = spawnSync(
    'docker',
    ['network', 'ls', '--filter', `name=${network}`, '--format', '{{ .Name }}'],
    { encoding: 'utf-8' },
  );
  if (exists.error) throw exists.error;
  if (exists.status !== 0) {
    console.error(exists.stderr);
    throw new Error('Failed to list Docker network');
  }
  if (exists.stdout) {
    return withTrustedProxyIps(config, inspectNetwork(network));
  }

  const create = spawnSync(
    'docker',
    ['network', 'create', '--driver', 'bridge', network],
    { encoding: 'utf-8' },
  );
  if (create.error) throw create.error;
  if (create.status !== 0) {
    console.error(create.stderr);
    throw new Error('Failed to create Docker network');
  }
  return withTrustedProxyIps(config, inspectNetwork(network));
}

function withTrustedProxyIps(
  config: VisageConfig,
  trustedProxyIps: readonly string[],
): VisageConfig {
  return {
    ...config,
    compose: {
      ...config.compose,
      network: {
        ...config.compose.network,
        trustedProxyIps: [
          ...config.compose.network.trustedProxyIps,
          ...trustedProxyIps,
        ],
      },
    },
  };
}

function inspectNetwork(name: string): readonly string[] {
  const result = spawnSync(
    'docker',
    [
      'network',
      'inspect',
      '--format',
      '{{range .IPAM.Config}}{{println .Subnet}}{{end}}',
      name,
    ],
    { encoding: 'utf-8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error('Failed to inspect Docker network');
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
