import { expect, test } from '@playwright/test';

import { completeDexLoginIfPresented } from './auth';
import { readHarnessManifest, simpleDexUser } from './harness';

const { simple } = readHarnessManifest();

test.describe('Visage simple authenticated upstream flow', () => {
  test.setTimeout(30_000);

  test('logs in through Dex and renders the authenticated whoami response', async ({
    page,
  }) => {
    await page.goto(simple.appUrl, { waitUntil: 'domcontentloaded' });
    await completeDexLoginIfPresented(page, simpleDexUser);

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
  }) => {
    const response = await request.get(simple.directUrl, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });
});
