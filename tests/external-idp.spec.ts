import { expect, test } from '@playwright/test';

test.describe('external-idp', () => {
  test('login with S256 PKCE', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { user } = test.info().project.metadata;
    const authorizationRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/idp/auth',
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const authorization = new URL((await authorizationRequest).url());
    expect(authorization.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorization.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

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
    expect(errors).toEqual([]);
  });

  test('reject direct host requests to the app server', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:6174/', {
      maxRedirects: 0,
      timeout: 1_000,
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });
});
