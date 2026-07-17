/**
 * T4 — Role-based login/logout and menu visibility matrix
 * Tests each of the three roles (regular user, org admin, super admin)
 * against staging; skips gracefully when env vars are absent.
 */

import { test, expect } from '@playwright/test';
import { accounts, loginAs, logout, skipIfMissingEnv } from './fixtures/auth';

test.describe('Auth — Regular User', () => {
  test.beforeEach(async ({ page }) => {
    const skip = skipIfMissingEnv(['regularUser']);
    if (skip) { test.skip(true, skip); return; }
    await loginAs(page, accounts.regularUser);
  });

  test('lands on dashboard after login', async ({ page }) => {
    await expect(page).toHaveURL(/\/(dashboard|$)/);
  });

  test('org-admin menu is not visible', async ({ page }) => {
    const orgAdminLink = page.locator('a[href="/org-admin"]');
    await expect(orgAdminLink).toHaveCount(0);
  });

  test('super-admin menu is not visible', async ({ page }) => {
    const superAdminLink = page.locator('a[href="/super-admin"]');
    await expect(superAdminLink).toHaveCount(0);
  });

  test('logout redirects to /login', async ({ page }) => {
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected route redirects to /login after logout', async ({ page }) => {
    await logout(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Auth — Org Admin', () => {
  test.beforeEach(async ({ page }) => {
    const skip = skipIfMissingEnv(['orgAdmin']);
    if (skip) { test.skip(true, skip); return; }
    await loginAs(page, accounts.orgAdmin);
  });

  test('lands on dashboard after login', async ({ page }) => {
    await expect(page).toHaveURL(/\/(dashboard|$)/);
  });

  test('org-admin menu is visible', async ({ page }) => {
    const orgAdminLink = page.locator('a[href="/org-admin"]');
    await expect(orgAdminLink).toBeVisible();
  });

  test('super-admin menu is not visible', async ({ page }) => {
    const superAdminLink = page.locator('a[href="/super-admin"]');
    await expect(superAdminLink).toHaveCount(0);
  });

  test('can navigate to org-admin dashboard', async ({ page }) => {
    await page.goto('/org-admin/dashboard');
    await expect(page).not.toHaveURL(/\/login/);
    // Page should render (no error boundary)
    await expect(page.locator('body')).not.toContainText('Unexpected Application Error');
  });

  test('logout redirects to /login', async ({ page }) => {
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Auth — Super Admin', () => {
  test.beforeEach(async ({ page }) => {
    const skip = skipIfMissingEnv(['superAdmin']);
    if (skip) { test.skip(true, skip); return; }
    await loginAs(page, accounts.superAdmin);
  });

  test('lands on dashboard after login', async ({ page }) => {
    await expect(page).toHaveURL(/\/(dashboard|$)/);
  });

  test('super-admin menu is visible', async ({ page }) => {
    const superAdminLink = page.locator('a[href="/super-admin"]');
    await expect(superAdminLink).toBeVisible();
  });

  test('can navigate to super-admin organizations', async ({ page }) => {
    await page.goto('/super-admin/organizations');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).not.toContainText('Unexpected Application Error');
  });

  test('logout redirects to /login', async ({ page }) => {
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });
});
