import { expect, test } from '@playwright/test';

const user = { email: 'user@example.com', password: 'pass' };

test.describe('external-idp', () => {
  test('login', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const emailInput = page.locator('input[name="login"]');
    const passwordInput = page.locator('input[name="password"]');
    const loginButton = page.locator('button[type="submit"]');
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(loginButton).toBeVisible();
    await emailInput.fill(user.email);
    await passwordInput.fill(user.password);
    await loginButton.click();

    const whoamiButton = page.getByRole('button', { name: 'Who am I?' });
    await expect(whoamiButton).toBeVisible();
    await whoamiButton.click();

    await expect(page.locator('[data-test-id="csr-identity"]')).toContainText(
      'Hostname',
    );
  });
});
