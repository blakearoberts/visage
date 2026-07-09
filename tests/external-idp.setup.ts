import { spawn, spawnSync } from 'node:child_process';

import { expect, request, test as setup } from '@playwright/test';

setup('start external idp example', async () => {
  const result = spawnSync('npm', [
    'run',
    'start:idp',
    '--workspace',
    'examples/external-idp',
  ]);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Failed to start external IdP');

  const child = spawn(
    'npm',
    ['run', 'dev', '--workspace', 'examples/external-idp'],
    { detached: true },
  );
  child.unref();
  process.env.EXTERNAL_IDP_PID = String(child.pid);

  const ctx = await request.newContext();
  await expect(async () => {
    const response = await ctx.get('https://127.0.0.1:9002');
    expect(response.status()).toBe(401);
  }).toPass();
  await ctx.dispose();
});
