import { spawnSync } from 'node:child_process';

import { expect, test as teardown } from '@playwright/test';

teardown('stop visage plugin', async () => {
  const str = process.env.PLUGIN_PID;
  if (str === undefined) throw new Error('PLUGIN_ID not set');
  const pid = Number.parseInt(str);
  if (isNaN(pid)) throw new Error('PLUGIN_PID not a number');
  try {
    process.kill(-pid, 'SIGINT');
  } catch {}

  await expect(() => {
    const containers = spawnSync(
      'docker',
      ['compose', '--project-name=simple-visage', 'ps', '--format={{.Name}}'],
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
