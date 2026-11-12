import { spawn } from 'node:child_process';

import { expect, request, test as setup } from '@playwright/test';

setup('start visage plugin', async () => {
  const child = spawn(
    'npm',
    ['run', 'dev', '--workspace', '@blakearoberts/visage-example-simple'],
    {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  child.unref();
  process.env.PLUGIN_PID = String(child.pid);

  const ctx = await request.newContext();
  await expect(async () => {
    const response = await ctx.get('https://localhost:9001');
    expect(response.status()).toBe(401);
  }).toPass();
  await ctx.dispose();
});
