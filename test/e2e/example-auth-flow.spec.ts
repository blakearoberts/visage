import { expect, request, test, type Locator, type Page } from '@playwright/test';
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const example = join(repo, 'examples/managed-service');
const appUrl = process.env.VISAGE_E2E_URL ?? 'https://localhost:9001/';
const dexEmail = process.env.VISAGE_E2E_EMAIL ?? 'user@example.com';
const dexPassword = process.env.VISAGE_E2E_PASSWORD ?? 'pass';
const targetUrl = new URL(appUrl);
let appComposeProject = '';
let logFile = '';
let vite: ChildProcessWithoutNullStreams | undefined;
let viteOutput = '';

type RenderedWhoamiResponse = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
  loading?: boolean;
};

test.describe('Visage authenticated upstream flow', () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(90_000);
    appComposeProject = projectName('managed_service', testInfo.workerIndex);
    logFile = testInfo.outputPath('managed-service.log');
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(logFile, '');

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

    const whoamiButton = page.getByRole('button', { name: 'Who are you?' });
    await expect(
      whoamiButton,
      'The app should expose a button that calls the authenticated /whoami/ upstream.',
    ).toBeVisible();

    await whoamiButton.click();

    const output = page.locator('pre').first();
    await expect(
      output,
      'Clicking the button should render the JSON response block.',
    ).toBeVisible();

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

  throw new Error(viteOutput || 'Managed service example did not start');
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

  await expect(
    loginInput,
    'Expected unauthenticated navigation to redirect to the Dex login form.',
  ).toBeVisible({ timeout: 30_000 });

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

function isTargetAppUrl(url: URL): boolean {
  return (
    url.origin === targetUrl.origin &&
    normalizePath(url.pathname) === normalizePath(targetUrl.pathname)
  );
}

function normalizePath(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function projectName(name: string, workerIndex: number): string {
  return `visage_e2e_${name}_${process.pid}_${workerIndex}`;
}

function writeLog(chunk: Uint8Array | string): void {
  const output = String(chunk);
  viteOutput += output;
  appendFileSync(logFile, output);
}
