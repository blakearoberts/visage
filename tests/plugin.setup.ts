import { spawn } from 'node:child_process';

import { expect, request, test as setup } from '@playwright/test';

setup('start visage plugin', async () => {
  const child = spawn('npm', ['run', 'dev', '--workspace', 'examples/simple'], {
    detached: true,
  });
  child.unref();
  process.env.PLUGIN_PID = String(child.pid);

  const ctx = await request.newContext();
  await expect(async () =>
    (await ctx.get('https://127.0.0.1:9001').catch()).ok(),
  ).toPass({ timeout: 5_000, intervals: [200] });
  await ctx.dispose();
});
