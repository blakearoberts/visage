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
import { dirname, join } from 'node:path';

import { e2eEnv, repo } from './environment';

const example = join(repo, 'examples/external-idp');
const appUrl = 'https://localhost:9002/';
const dexEmail = 'user@example.com';
const dexPassword = 'pass';
const appComposeProject = 'external-idp-visage';
const externalDexProject = 'external-idp';

type ExternalIdpApp = {
  readonly appUrl: string;
};

const test = base.extend<{}, { externalIdpApp: ExternalIdpApp }>({
  externalIdpApp: [
    async ({}, use, workerInfo) => {
      let viteOutput = '';
      let vite: ChildProcessWithoutNullStreams | undefined;
      const logFile = join(
        workerInfo.project.outputDir,
        'external-idp-auth-flow',
        `worker-${workerInfo.workerIndex}.log`,
      );
      const writeLog = (chunk: Uint8Array | string): void => {
        const output = String(chunk);
        viteOutput += output;
        appendFileSync(logFile, output);
      };

      mkdirSync(dirname(logFile), { recursive: true });
      writeFileSync(logFile, '');

      try {
        dockerCompose(['down', '--remove-orphans'], writeLog);
        dockerCompose(['up', '-d'], writeLog);

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

        await waitForApp(appUrl, vite, () => viteOutput);
        await use({ appUrl });
      } finally {
        writeDockerComposeLogs(
          appComposeProject,
          'node_modules/.vite/visage/compose.yaml',
          writeLog,
        );
        writeDockerComposeLogs(
          externalDexProject,
          'compose.idp.yaml',
          writeLog,
        );
        if (vite !== undefined) {
          await stopVite(vite);
        }
        dockerCompose(['down', '--remove-orphans'], writeLog);
      }
    },
    { scope: 'worker' },
  ],
});

test.describe('Visage external IdP authenticated upstream flow', () => {
  test.setTimeout(30_000);

  test('logs in through an external IdP and renders the authenticated whoami response', async ({
    page,
    externalIdpApp,
  }) => {
    await page.goto(externalIdpApp.appUrl, { waitUntil: 'domcontentloaded' });
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

  throw new Error(getViteOutput() || 'External IdP example did not start');
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

function dockerCompose(
  args: string[],
  writeLog: (chunk: Uint8Array | string) => void,
): void {
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

function writeDockerComposeLogs(
  project: string,
  file: string,
  writeLog: (chunk: Uint8Array | string) => void,
): void {
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
