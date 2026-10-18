import { expect, test } from '@playwright/test';

const user = { email: 'user@example.com', password: 'pass' };

test('exchanges the managed Dex access token through live OPA policy', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.locator('input[name="login"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('button[type="submit"]').click();

  const requested = page.locator('[data-field="Requested scopes"]');
  const granted = page.locator('[data-field="Granted scopes"]');
  await expect(requested).toHaveText('user.read user.write');
  await expect(granted).toHaveText('user.read');
  await expect(granted).not.toContainText('user.write');
  await expect(page.locator('[data-field="User email"]')).toHaveText(
    user.email,
  );
  await expect(page.locator('[data-field="Resource audience"]')).toHaveText(
    'urn:visage:example:user-api',
  );
  await expect(page.locator('[data-field="Actor"]')).toHaveText('web-app');
});
