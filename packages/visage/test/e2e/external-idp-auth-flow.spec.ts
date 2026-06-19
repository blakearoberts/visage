import { expect, test } from '@playwright/test';

import { completeDexLoginIfPresented } from './auth';
import { readHarnessManifest } from './harness';

const { externalIdp } = readHarnessManifest();

test.describe('Visage external IdP authenticated upstream flow', () => {
  test.setTimeout(30_000);

  test('logs in through an external IdP and renders the authenticated whoami response', async ({
    page,
  }) => {
    await page.goto(externalIdp.appUrl, { waitUntil: 'domcontentloaded' });
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
