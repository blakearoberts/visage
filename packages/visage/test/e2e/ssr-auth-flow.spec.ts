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

const example = join(repo, 'examples/ssr');
const appUrl = 'https://localhost:9003/';
const directUrl = 'http://127.0.0.1:6175/';
const dexEmail = 'user@example.com';
const dexPassword = 'pass';
const appComposeProject = 'ssr-visage';

type SsrApp = {
  readonly appUrl: string;
  readonly directUrl: string;
};

const test = base.extend<{}, { ssrApp: SsrApp }>({
  ssrApp: [
    async ({}, use, workerInfo) => {
      let ssrOutput = '';
      const logFile = join(
        workerInfo.project.outputDir,
        'ssr-auth-flow',
        `worker-${workerInfo.workerIndex}.log`,
      );
      const writeLog = (chunk: Uint8Array | string): void => {
        const output = String(chunk);
        ssrOutput += output;
        appendFileSync(logFile, output);
      };

      mkdirSync(dirname(logFile), { recursive: true });
      writeFileSync(logFile, '');

      const ssr = spawn('npm', ['run', 'dev'], {
        cwd: example,
        env: e2eEnv(),
      });

      ssr.stdout.on('data', (chunk) => {
        writeLog(chunk);
      });
      ssr.stderr.on('data', (chunk) => {
        writeLog(chunk);
      });

      try {
        await waitForApp(appUrl, ssr, () => ssrOutput);
        await use({ appUrl, directUrl });
      } finally {
        writeDockerComposeLogs(appComposeProject, writeLog);
        await stopSsr(ssr);
      }
    },
    { scope: 'worker' },
  ],
});

test.describe('Visage SSR authenticated identity flow', () => {
  test.setTimeout(30_000);

  test('logs in through Dex and renders authenticated identity during SSR', async ({
    page,
    ssrApp,
  }) => {
    await page.goto(ssrApp.appUrl, { waitUntil: 'domcontentloaded' });
    await completeDexLoginIfPresented(page);

    await expect(
      page.getByRole('heading', { name: 'Hello from Visage' }),
    ).toBeVisible();

    const response = await page.context().request.get(ssrApp.appUrl, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);

    const html = await response.text();
    expect(html).toContain('data-test-id="ssr-identity"');
    expect(html).toContain(dexEmail);
    expect(html).not.toContain('<!--ssr-outlet-->');

    const ssrIdentity = page.locator('[data-test-id="ssr-identity"]');
    await expect(ssrIdentity).toContainText('email:');
    await expect(ssrIdentity).toContainText(dexEmail);

    const csrIdentity = page.locator('[data-test-id="csr-identity"]');
    await expect(
      csrIdentity,
      'Expected the hydrated app to keep calling the authenticated /whoami/ upstream.',
    ).toContainText('Hostname', { timeout: 5_000 });
  });

  test('rejects direct requests to the SSR app server', async ({
    request,
    ssrApp,
  }) => {
    const response = await request.get(ssrApp.directUrl, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });
});

async function waitForApp(
  appUrl: string,
  ssr: ChildProcessWithoutNullStreams,
  getSsrOutput: () => string,
): Promise<void> {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  const timeout = Date.now() + 15_000;

  try {
    while (Date.now() < timeout) {
      if (ssr.exitCode !== null) {
        throw new Error(getSsrOutput());
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

  throw new Error(getSsrOutput() || 'SSR example did not start');
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

async function stopSsr(ssr: ChildProcessWithoutNullStreams): Promise<void> {
  if (ssr.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      ssr.kill('SIGKILL');
      resolve();
    }, 5_000);

    ssr.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    ssr.kill('SIGINT');
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
      join(example, '.visage/compose.yaml'),
      'logs',
      '--no-color',
    ],
    { encoding: 'utf8' },
  );

  writeLog(result.stdout);
  writeLog(result.stderr);
}
