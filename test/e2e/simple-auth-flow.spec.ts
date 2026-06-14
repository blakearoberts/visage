import {
  expect,
  request,
  test as base,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';

import { e2eEnv, repo } from './environment';

const example = join(repo, 'examples/simple');
const appUrl = process.env.VISAGE_E2E_URL ?? 'https://localhost:9001/';
const dexEmail = process.env.VISAGE_E2E_EMAIL ?? 'user@example.com';
const dexPassword = process.env.VISAGE_E2E_PASSWORD ?? 'pass';
const appComposeProject = 'simple-visage';

type SimpleApp = {
  readonly appUrl: string;
  readonly directUrl: string;
};

const test = base.extend<{}, { simpleApp: SimpleApp }>({
  simpleApp: [
    async ({}, use, workerInfo) => {
      let viteOutput = '';
      const logFile = join(
        workerInfo.project.outputDir,
        'simple-auth-flow',
        `worker-${workerInfo.workerIndex}.log`,
      );
      const writeLog = (chunk: Uint8Array | string): void => {
        const output = String(chunk);
        viteOutput += output;
        appendFileSync(logFile, output);
      };

      mkdirSync(dirname(logFile), { recursive: true });
      writeFileSync(logFile, '');

      const vite = spawn('npm', ['run', 'dev'], {
        cwd: example,
        env: e2eEnv(),
      });

      vite.stdout.on('data', (chunk) => {
        writeLog(chunk);
      });
      vite.stderr.on('data', (chunk) => {
        writeLog(chunk);
      });

      try {
        await waitForApp(appUrl, vite, () => viteOutput);
        await use({ appUrl, directUrl: viteDirectUrl() });
      } finally {
        writeDockerComposeLogs(appComposeProject, writeLog);
        await stopVite(vite);
      }
    },
    { scope: 'worker' },
  ],
});

test.describe('Visage simple authenticated upstream flow', () => {
  test.setTimeout(30_000);

  test('logs in through Dex and renders the authenticated whoami response', async ({
    page,
    simpleApp,
  }) => {
    await page.goto(simpleApp.appUrl, { waitUntil: 'domcontentloaded' });
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

  test('rejects direct requests to the Vite dev server', async ({
    request,
    simpleApp,
  }) => {
    const response = await request.get(simpleApp.directUrl, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });
});

async function waitForApp(
  appUrl: string,
  vite: ChildProcessWithoutNullStreams,
  getViteOutput: () => string,
): Promise<void> {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  const timeout = Date.now() + 15_000;

  try {
    while (Date.now() < timeout) {
      if (vite.exitCode !== null) {
        throw new Error(getViteOutput());
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

  throw new Error(getViteOutput() || 'Simple example did not start');
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

async function stopVite(vite: ChildProcessWithoutNullStreams): Promise<void> {
  if (vite.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      vite.kill('SIGKILL');
      resolve();
    }, 5_000);

    vite.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    vite.kill('SIGTERM');
  });
}

function writeDockerComposeLogs(
  appComposeProject: string,
  writeLog: (chunk: Uint8Array | string) => void,
): void {
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

function viteDirectUrl(): string {
  return `http://${viteDirectHost()}:6173/`;
}

function viteDirectHost(): string {
  if (process.platform !== 'linux') return '127.0.0.1';

  const result = spawnSync(
    'docker',
    [
      'network',
      'inspect',
      'bridge',
      '--format',
      '{{range .IPAM.Config}}{{println .Gateway}}{{end}}',
    ],
    { encoding: 'utf8' },
  );

  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => isIP(line)) ?? '127.0.0.1'
  );
}
