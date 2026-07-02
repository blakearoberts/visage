import { spawn } from 'node:child_process';

import { expect, request, test as setup } from '@playwright/test';

setup('start server example', async () => {
  const child = spawn('npm', ['run', 'dev', '--workspace', 'examples/ssr'], {
    detached: true,
  });
  child.unref();
  process.env.SERVER_PID = String(child.pid);

  const ctx = await request.newContext();
  await expect(async () => {
    const response = await ctx.get('https://127.0.0.1:9003');
    expect(response.ok()).toBe(true);
  }).toPass();
  await ctx.dispose();
});
