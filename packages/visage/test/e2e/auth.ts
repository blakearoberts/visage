import { expect, type Locator, type Page } from '@playwright/test';

import { externalIdpUser, type DexCredentials } from './harness';

export async function completeDexLoginIfPresented(
  page: Page,
  credentials: DexCredentials = externalIdpUser,
): Promise<void> {
  if (
    await isVisible(
      page.getByRole('heading', { name: 'Hello from Visage' }),
      1_000,
    )
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
  ).toBeVisible({ timeout: 5_000 });

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

  await loginInput.fill(credentials.email);
  await passwordInput.fill(credentials.password);

  const submitButton = page
    .getByRole('button', { name: /log in|login|sign in/i })
    .first();

  await submitLoginForm(submitButton, passwordInput);

  const appHeading = page.getByRole('heading', { name: 'Hello from Visage' });
  await expect(appHeading).toBeVisible({ timeout: 5_000 });
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
