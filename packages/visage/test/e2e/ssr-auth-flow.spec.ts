import { expect, test } from '@playwright/test';

import { completeDexLoginIfPresented } from './auth';
import { readHarnessManifest, ssrDexUser } from './harness';

const { ssr } = readHarnessManifest();

test.describe('Visage SSR authenticated identity flow', () => {
  test.setTimeout(30_000);

  test('logs in through Dex and renders authenticated identity during SSR', async ({
    page,
  }) => {
    await page.goto(ssr.appUrl, { waitUntil: 'domcontentloaded' });
    await completeDexLoginIfPresented(page, ssrDexUser);

    await expect(
      page.getByRole('heading', { name: 'Hello from Visage' }),
    ).toBeVisible();

    const response = await page.context().request.get(ssr.appUrl, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);

    const html = await response.text();
    expect(html).toContain('data-test-id="ssr-identity"');
    expect(html).toContain(ssrDexUser.email);
    expect(html).not.toContain('<!--ssr-outlet-->');

    const ssrIdentity = page.locator('[data-test-id="ssr-identity"]');
    await expect(ssrIdentity).toContainText('email:');
    await expect(ssrIdentity).toContainText(ssrDexUser.email);

    const csrIdentity = page.locator('[data-test-id="csr-identity"]');
    await expect(
      csrIdentity,
      'Expected the hydrated app to keep calling the authenticated /whoami/ upstream.',
    ).toContainText('Hostname', { timeout: 5_000 });
  });

  test('rejects direct requests to the SSR app server', async ({ request }) => {
    const response = await request.get(ssr.directUrl, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });
});
