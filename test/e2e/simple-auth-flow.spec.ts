import {
  expect,
  request,
  test,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { e2eEnv, repo } from './environment';

const example = join(repo, 'examples/simple');
const appUrl = process.env.VISAGE_E2E_URL ?? 'https://localhost:9001/';
const dexEmail = process.env.VISAGE_E2E_EMAIL ?? 'user@example.com';
const dexPassword = process.env.VISAGE_E2E_PASSWORD ?? 'pass';
let logFile = '';
let vite: ChildProcessWithoutNullStreams | undefined;
let viteOutput = '';

test.describe('Visage simple authenticated upstream flow', () => {
  test.setTimeout(30_000);
  let appComposeProject = '';

  test.beforeAll(async ({}, testInfo) => {
    appComposeProject = `visage_e2e_${testInfo.workerIndex}`;
    logFile = testInfo.outputPath('simple.log');
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(logFile, '');

    vite = spawn('npm', ['run', 'dev'], {
      cwd: example,
      env: e2eEnv({
        COMPOSE_PROJECT_NAME: appComposeProject,
      }),
    });

    vite.stdout.on('data', (chunk) => {
      writeLog(chunk);
    });
    vite.stderr.on('data', (chunk) => {
      writeLog(chunk);
    });

    await waitForApp();
  });

  test.afterAll(async () => {
    writeDockerComposeLogs(appComposeProject);
    await stopVite();
  });

  test('logs in through Dex and renders the authenticated whoami response', async ({
    page,
  }) => {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await completeDexLoginIfPresented(page);

    await expect(
      page.getByRole('heading', { name: 'Hello from Visage' }),
    ).toBeVisible();

    const output = page.locator('pre').first();
    await expect(
      output,
      'Expected the rendered response body to contain the authenticated upstream whoami response.',
    ).toContainText('Hostname', { timeout: 5_000 });
  });
});

async function waitForApp(): Promise<void> {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  const timeout = Date.now() + 15_000;

  try {
    while (Date.now() < timeout) {
      if (vite !== undefined && vite.exitCode !== null) {
        throw new Error(viteOutput);
      }

      try {
        const response = await context.get(appUrl, {
          maxRedirects: 0,
          timeout: 5_000,
        });
        if (response.status() < 500) {
          return;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  } finally {
    await context.dispose();
  }

  throw new Error(viteOutput || 'Simple example did not start');
}

async function completeDexLoginIfPresented(page: Page): Promise<void> {
  if (
    await isVisible(
      page.getByRole('heading', { name: 'Hello from Visage' }),
      1_000,
    )
  ) {
    return;
  }

  const loginInput = page
    .locator(
      [
        'input[name="login"]',
        'input#login',
        'input[name="email"]',
        'input[type="email"]',
        'input[autocomplete="username"]',
      ].join(', '),
    )
    .first();

  await expect(
    loginInput,
    'Expected unauthenticated navigation to redirect to the Dex login form.',
  ).toBeVisible({ timeout: 5_000 });

  const passwordInput = page
    .locator(
      [
        'input[name="password"]',
        'input#password',
        'input[type="password"]',
        'input[autocomplete="current-password"]',
      ].join(', '),
    )
    .first();

  await loginInput.fill(dexEmail);
  await passwordInput.fill(dexPassword);

  const submitButton = page
    .getByRole('button', { name: /log in|login|sign in/i })
    .first();

  await submitLoginForm(submitButton, passwordInput);

  const appHeading = page.getByRole('heading', { name: 'Hello from Visage' });
  await expect(appHeading).toBeVisible({ timeout: 5_000 });
}

async function submitLoginForm(
  submitButton: Locator,
  passwordInput: Locator,
): Promise<void> {
  if (await isVisible(submitButton, 2_000)) {
    await submitButton.click();
    return;
  }

  await passwordInput.press('Enter');
}

async function isVisible(locator: Locator, timeout = 5_000): Promise<boolean> {
  try {
    await expect(locator).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function stopVite(): Promise<void> {
  const running = vite;
  if (running === undefined || running.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      running.kill('SIGKILL');
      resolve();
    }, 5_000);

    running.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    running.kill('SIGTERM');
  });
}

function writeDockerComposeLogs(appComposeProject: string): void {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-p',
      appComposeProject,
      '-f',
      join(example, 'node_modules/.vite/visage/compose.yaml'),
      'logs',
      '--no-color',
    ],
    { encoding: 'utf8' },
  );

  writeLog(result.stdout);
  writeLog(result.stderr);
}

function writeLog(chunk: Uint8Array | string): void {
  const output = String(chunk);
  viteOutput += output;
  appendFileSync(logFile, output);
}
