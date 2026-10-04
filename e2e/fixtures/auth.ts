import { expect, type Page } from '@playwright/test';

export interface TestAccount {
  email: string;
  password: string;
}

// Accounts loaded from env — tests skip when undefined
export const accounts = {
  regularUser: {
    email: process.env.E2E_USER_EMAIL ?? '',
    password: process.env.E2E_USER_PASSWORD ?? '',
  },
  orgAdmin: {
    email: process.env.E2E_ORG_ADMIN_EMAIL ?? '',
    password: process.env.E2E_ORG_ADMIN_PASSWORD ?? '',
  },
  superAdmin: {
    email: process.env.E2E_SUPER_ADMIN_EMAIL ?? '',
    password: process.env.E2E_SUPER_ADMIN_PASSWORD ?? '',
  },
  orgBUser: {
    email: process.env.E2E_ORG_B_USER_EMAIL ?? '',
    password: process.env.E2E_ORG_B_USER_PASSWORD ?? '',
  },
} satisfies Record<string, TestAccount>;

export function skipIfMissingEnv(accountNames: (keyof typeof accounts)[]) {
  const missing = accountNames.filter(n => !accounts[n].email || !accounts[n].password);
  if (missing.length > 0) {
    return `Skipped: set email and password env vars for ${missing.join(', ')} to run this test`;
  }
  return null;
}

export async function loginAs(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  // Try multiple selectors since the exact attribute depends on the login form implementation
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();

  await emailInput.fill(account.email);
  await passwordInput.fill(account.password);

  // Submit — try data-testid first, then type=submit
  const submitBtn = page.locator('[data-testid="login-btn"], button[type="submit"]').first();
  await submitBtn.click();

  // Wait for redirect away from /login (auth success)
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 });
}

export async function logout(page: Page): Promise<void> {
  // Logout is a UI action in Wardah; there is deliberately no /logout route.
  // Wait for the real hydrated header instead of racing it and falling back to
  // a route the application does not own.
  const userMenu = page.locator('[data-testid="user-menu"]').first();
  await expect(userMenu).toBeVisible({ timeout: 10_000 });
  await userMenu.click();

  const logoutButton = page.locator('[data-testid="logout-btn"]').first();
  await expect(logoutButton).toBeVisible({ timeout: 5_000 });
  await logoutButton.click();

  await page.waitForURL(url => url.pathname.includes('/login'), { timeout: 10_000 });
}

// Capture Supabase API errors from a page (4xx/5xx on /rest/v1 or /functions/v1)
export function attachSupabaseErrorListener(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('response', response => {
    const url = response.url();
    const status = response.status();
    if ((url.includes('/rest/v1') || url.includes('/functions/v1')) && status >= 400) {
      errors.push(`${status} ${response.request().method()} ${url}`);
    }
  });
  return { errors };
}
