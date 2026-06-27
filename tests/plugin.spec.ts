import { expect, test } from '@playwright/test';

const user = { email: 'user@example.com', password: 'pass' };

test.describe('plugin', () => {
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

    await expect(page.locator('[data-test-id="csr-identity"]')).toContainText(
      'Hostname',
    );
  });

  test('rejects direct requests to the Vite dev server', async ({
    request,
  }) => {
    const response = await request.get('http://127.0.0.1:6173/', {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });
});
