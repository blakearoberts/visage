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

const example = join(repo, 'examples/external-idp');
const appUrl = 'https://localhost:9002/';
const dexEmail = 'user@example.com';
const dexPassword = 'pass';
const appComposeProject = 'visage-external-idp-example-visage';
const externalDexProject = 'visage-external-idp';

let logFile = '';
let vite: ChildProcessWithoutNullStreams | undefined;
let viteOutput = '';

test.describe('Visage external IdP authenticated upstream flow', () => {
  test.setTimeout(30_000);

  test.beforeAll(async ({}, testInfo) => {
    logFile = testInfo.outputPath('external-idp.log');
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(logFile, '');

    dockerCompose(['down', '--remove-orphans']);
    dockerCompose(['up', '-d']);

    vite = spawn('npm', ['run', 'dev'], {
      cwd: example,
      env: e2eEnv(),
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
    writeDockerComposeLogs(
      appComposeProject,
      'node_modules/.vite/visage/compose.yaml',
    );
    writeDockerComposeLogs(externalDexProject, 'compose.idp.yaml');
    await stopVite();
    dockerCompose(['down', '--remove-orphans']);
  });

  test('logs in through an external IdP and renders the authenticated whoami response', async ({
    page,
  }) => {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await completeDexLoginIfPresented(page);

    await expect(
      page.getByRole('heading', { name: 'Hello from Visage' }),
    ).toBeVisible();

    const whoamiButton = page.getByRole('button', { name: 'Who am I?' });
    await expect(whoamiButton).toBeVisible();

    await whoamiButton.click();

    const output = page.locator('[aria-label="Whoami response body"]');
    await expect(output).toBeVisible();

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
      if (vite?.exitCode !== null) {
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

  throw new Error(viteOutput || 'External IdP example did not start');
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

  await expect(loginInput).toBeVisible({ timeout: 5_000 });

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

function dockerCompose(args: string[]): void {
  const result = spawnSync(
    'docker',
    ['compose', '-p', externalDexProject, '-f', 'compose.idp.yaml', ...args],
    {
      cwd: example,
      encoding: 'utf8',
    },
  );
  writeLog(result.stdout);
  writeLog(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error('External IdP Docker Compose failed');
}

function writeDockerComposeLogs(project: string, file: string): void {
  const result = spawnSync(
    'docker',
    ['compose', '-p', project, '-f', file, 'logs', '--no-color'],
    {
      cwd: example,
      encoding: 'utf8',
    },
  );
  writeLog(result.stdout);
  writeLog(result.stderr);
}

function writeLog(chunk: Uint8Array | string): void {
  const output = String(chunk);
  viteOutput += output;
  appendFileSync(logFile, output);
}
