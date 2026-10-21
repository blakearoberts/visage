import { expect, test, type Page } from '@playwright/test';

const user = { email: 'user@example.com', password: 'pass' };

async function login(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.locator('input[name="login"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('button[type="submit"]').click();

  await expect(page.locator('[data-test-id="csr-identity"]')).toContainText(
    'Hostname',
  );
}

test('reject direct host requests to the app server', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:6173/', {
    maxRedirects: 0,
    timeout: 1_000,
  });

  expect(response.status()).toBe(403);
  expect(await response.text()).toBe('Forbidden');
});

test('session recovery reuses the IdP session through the popup', async ({
  page,
  context,
}) => {
  await login(page);
  await context.clearCookies({ name: '__Host-sess' });
  await page.getByRole('button', { name: 'Revalidate' }).click();
  await expect(
    page.getByRole('button', { name: 'Sign back in' }),
  ).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign back in' }).click();
  const popup = await popupPromise;
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.getByRole('button', { name: 'Sign back in' })).toBeHidden();
});

test('session recovery requires credentials without an IdP session', async ({
  page,
  context,
}) => {
  await login(page);
  await context.clearCookies();
  await page.getByRole('button', { name: 'Revalidate' }).click();
  await expect(
    page.getByRole('button', { name: 'Sign back in' }),
  ).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign back in' }).click();
  const popup = await popupPromise;
  await expect(popup.locator('input[name="login"]')).toBeVisible();
  await popup.locator('input[name="login"]').fill(user.email);
  await popup.locator('input[name="password"]').fill(user.password);
  await popup.locator('button[type="submit"]').click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.getByRole('button', { name: 'Sign back in' })).toBeHidden();
});

test('sign out ends app and IdP sessions and starts a fresh login', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('input[name="login"]')).toBeVisible();
  const names = (await page.context().cookies()).map((cookie) => cookie.name);
  expect(names).not.toContain('__Host-sess');
  expect(names).not.toContain('dex_session');
});

test('sign-out fetch without an app session returns 401', async ({
  request,
}) => {
  expect(
    (await request.get('/oauth2/sign_out', { maxRedirects: 0 })).status(),
  ).toBe(401);
});

test('sign-out navigation without an app or IdP session reaches login', async ({
  page,
}) => {
  await page.goto('/oauth2/sign_out');
  await expect(page.locator('input[name="login"]')).toBeVisible();
});

test('sign-out navigation with only an IdP session ends app and IdP sessions', async ({
  page,
  context,
}) => {
  await login(page);
  await context.clearCookies({ name: '__Host-sess' });
  await page.goto('/oauth2/sign_out');
  await expect(page.locator('input[name="login"]')).toBeVisible();
  const names = (await page.context().cookies()).map((cookie) => cookie.name);
  expect(names).not.toContain('__Host-sess');
  expect(names).not.toContain('dex_session');
});

test('sign out after the IdP session ends clears the app session and reaches login', async ({
  page,
}) => {
  await login(page);
  await expect(await page.request.post('/dex/logout')).toBeOK();
  await page.goto('/oauth2/sign_out');
  await expect(page.locator('input[name="login"]')).toBeVisible();
  const names = (await page.context().cookies()).map((cookie) => cookie.name);
  expect(names).not.toContain('__Host-sess');
  expect(names).not.toContain('dex_session');
});
