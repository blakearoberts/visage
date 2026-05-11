import { expect, request, test, type Locator, type Page } from '@playwright/test';
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const example = join(repo, 'examples/external-idp');
const appUrl = 'https://localhost:9002/';
const targetUrl = new URL(appUrl);
const dexEmail = 'user@example.com';
const dexPassword = 'pass';
const externalDexProject = 'visage-external-idp';
const appComposeProject = 'visage_external_idp_app';

let logFile = '';
let vite: ChildProcessWithoutNullStreams | undefined;
let viteOutput = '';

test.describe('Visage external IdP authenticated upstream flow', () => {
  test.setTimeout(120_000);

  test.beforeAll(async ({}, testInfo) => {
    logFile = testInfo.outputPath('external-idp.log');
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(logFile, '');

    dockerCompose(['down', '--remove-orphans']);
    dockerCompose(['up', '-d']);

    vite = spawn('npm', ['run', 'dev'], {
      cwd: example,
      env: {
        ...process.env,
        COMPOSE_PROJECT_NAME: appComposeProject,
      },
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

    const whoamiButton = page.getByRole('button', { name: 'Who are you?' });
    await expect(whoamiButton).toBeVisible();

    await whoamiButton.click();

    const output = page.locator('pre').first();
    await expect(output).toBeVisible();

    await expect
      .poll(
        async () => {
          const payload = await readRenderedWhoamiResponse(output);
          return payload?.status ?? payload?.error ?? 'pending';
        },
        {
          message:
            'Expected the rendered JSON response to contain a successful upstream status.',
          timeout: 30_000,
        },
      )
      .toBe(200);

    const payload = await readRenderedWhoamiResponse(output);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        status: 200,
      }),
    );
    expect(payload?.body).toEqual(expect.stringContaining('Hostname'));
  });
});

async function waitForApp(): Promise<void> {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  const timeout = Date.now() + 90_000;

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
    await isVisible(page.getByRole('heading', { name: 'Hello from Visage' }))
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

  await expect(loginInput).toBeVisible({ timeout: 30_000 });

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

  const grantAccessButton = page.getByRole('button', { name: 'Grant Access' });
  if (await isVisible(grantAccessButton, 10_000)) {
    await grantAccessButton.click();
  }

  await page.waitForURL(isTargetAppUrl, { timeout: 45_000 });
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

async function readRenderedWhoamiResponse(
  output: Locator,
): Promise<RenderedWhoamiResponse | null> {
  const text = await output.textContent();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as RenderedWhoamiResponse;
  } catch {
    return null;
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
    }, 10_000);

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
  if (result.status !== 0) throw new Error('External IdP Docker Compose failed');
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

function isTargetAppUrl(url: URL): boolean {
  return (
    url.origin === targetUrl.origin &&
    normalizePath(url.pathname) === normalizePath(targetUrl.pathname)
  );
}

function normalizePath(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

type RenderedWhoamiResponse = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
  loading?: boolean;
};

function writeLog(chunk: Uint8Array | string): void {
  const output = String(chunk);
  viteOutput += output;
  appendFileSync(logFile, output);
}
