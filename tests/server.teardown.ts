import { spawnSync } from 'node:child_process';

import { expect, test as teardown } from '@playwright/test';

teardown('stop server example', async () => {
  const str = process.env.SERVER_PID;
  if (str === undefined) throw new Error('SERVER_PID not set');
  const pid = Number.parseInt(str);
  if (isNaN(pid)) throw new Error('SERVER_PID not a number');
  try {
    process.kill(-pid, 'SIGINT');
  } catch {}

  await expect(() => {
    const containers = spawnSync(
      'docker',
      ['compose', '--project-name=ssr-visage', 'ps', '--format={{.Name}}'],
      { encoding: 'utf8' },
    )
      .stdout.split(/\r?\n/)
      .filter(Boolean);
    expect(containers).toHaveLength(0);
  }).toPass({ timeout: 5_000, intervals: [100] });

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {}
});
