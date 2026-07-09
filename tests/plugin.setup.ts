import { spawn } from 'node:child_process';

import { expect, request, test as setup } from '@playwright/test';

setup('start visage plugin', async () => {
  const child = spawn('npm', ['run', 'dev', '--workspace', 'examples/simple'], {
    detached: true,
  });
  child.unref();
  process.env.PLUGIN_PID = String(child.pid);

  const ctx = await request.newContext();
  await expect(async () => {
    const response = await ctx.get('https://127.0.0.1:9001');
    expect(response.status()).toBe(401);
  }).toPass();
  await ctx.dispose();
});
