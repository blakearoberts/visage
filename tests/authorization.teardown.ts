import { spawnSync } from 'node:child_process';

import { expect, test as teardown } from '@playwright/test';

teardown('stop authorization example', async () => {
  const value = process.env.AUTHORIZATION_PID;
  if (value === undefined) throw new Error('AUTHORIZATION_PID not set');
  const pid = Number.parseInt(value);
  if (Number.isNaN(pid)) throw new Error('AUTHORIZATION_PID not a number');
  try {
    process.kill(-pid, 'SIGINT');
  } catch {}

  await expect(() => {
    const containers = spawnSync(
      'docker',
      [
        'compose',
        '--project-name=authorization-visage',
        'ps',
        '--format={{.Name}}',
      ],
      { encoding: 'utf8' },
    )
      .stdout.split(/\r?\n/)
      .filter(Boolean);
    expect(containers).toHaveLength(0);
  }).toPass();

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {}
});
