import { spawn } from 'node:child_process';

import { expect, request, test as setup } from '@playwright/test';

setup('start authorization example', async () => {
  const child = spawn(
    'npm',
    ['run', 'dev', '--workspace', 'examples/authorization'],
    { detached: true },
  );
  child.unref();
  process.env.AUTHORIZATION_PID = String(child.pid);

  const context = await request.newContext();
  await expect(async () => {
    const response = await context.get('https://127.0.0.1:9005');
    expect(response.status()).toBe(401);
    const policy = await context.post(
      'https://127.0.0.1:9005/opa/v1/data/visage/authorization/exchange',
      { data: { input: {} } },
    );
    expect(policy.status()).toBe(200);
  }).toPass();
  await context.dispose();
});
