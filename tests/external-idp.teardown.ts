import { spawnSync } from 'node:child_process';

import { expect, test as teardown } from '@playwright/test';

teardown('stop external idp example', async () => {
  const str = process.env.EXTERNAL_IDP_PID;
  if (str === undefined) throw new Error('EXTERNAL_IDP_PID not set');
  const pid = Number.parseInt(str);
  if (isNaN(pid)) throw new Error('EXTERNAL_IDP_PID not a number');
  try {
    process.kill(-pid, 'SIGINT');
  } catch {}

  await expect(() => {
    const containers = spawnSync(
      'docker',
      [
        'compose',
        '--project-name=external-idp-visage',
        'ps',
        '--format={{.Name}}',
      ],
      { encoding: 'utf8' },
    )
      .stdout.split(/\r?\n/)
      .filter(Boolean);
    expect(containers).toHaveLength(0);
  }).toPass({ timeout: 5_000, intervals: [100] });

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {}

  const result = spawnSync('npm', [
    'run',
    'stop:idp',
    '--workspace',
    'examples/external-idp',
  ]);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Failed to stop external IdP');
});
