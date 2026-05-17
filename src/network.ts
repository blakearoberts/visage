import { spawnSync } from 'node:child_process';

import type { VisageConfig } from './config';

export function ensureNginxNetwork(config: VisageConfig): VisageConfig {
  const exists = spawnSync(
    'docker',
    [
      'network',
      'ls',
      '--filter',
      `name=${config.network.name}`,
      '--format',
      '{{ .Name }}',
    ],
    { encoding: 'utf-8' },
  );
  if (exists.error) throw exists.error;
  if (exists.status !== 0) {
    console.error(exists.stderr);
    throw new Error('Failed to list Docker network');
  }
  if (exists.stdout) {
    return {
      ...config,
      network: {
        ...config.network,
        trustedProxyIps: inspectNetwork(config.network.name),
      },
    };
  }

  const create = spawnSync(
    'docker',
    ['network', 'create', '--driver', 'bridge', config.network.name],
    { encoding: 'utf-8' },
  );
  if (create.error) throw create.error;
  if (create.status !== 0) {
    console.error(create.stderr);
    throw new Error('Failed to create Docker network');
  }
  return {
    ...config,
    network: {
      ...config.network,
      trustedProxyIps: inspectNetwork(config.network.name),
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
