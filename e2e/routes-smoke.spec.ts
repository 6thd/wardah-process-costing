/**
 * T4 — Smoke test: every main sidebar route loads without
 * Supabase 4xx/5xx errors and without an error-boundary crash screen.
 *
 * Logged in as regularUser. Org-admin and super-admin routes
 * are skipped for this role (covered in auth-roles.spec.ts).
 */

import { test, expect } from '@playwright/test';
import { accounts, loginAs, skipIfMissingEnv, attachSupabaseErrorListener } from './fixtures/auth';

// All routes accessible to a regular user
const ROUTES = [
  '/dashboard',
  '/dashboard/overview',
  '/dashboard/analytics',
  '/dashboard/performance',
  '/manufacturing',
  '/manufacturing/overview',
  '/manufacturing/orders',
  '/manufacturing/mes',
  '/manufacturing/routing',
  '/manufacturing/process-costing',
  '/manufacturing/stages',
  '/manufacturing/bom',
  '/manufacturing/quality',
  '/inventory',
  '/inventory/overview',
  '/inventory/items',
  '/inventory/categories',
  '/inventory/movements',
  '/inventory/adjustments',
  '/inventory/valuation',
  '/inventory/warehouses',
  '/inventory/transfers',
  '/purchasing',
  '/purchasing/overview',
  '/purchasing/suppliers',
  '/purchasing/orders',
  '/purchasing/invoices',
  '/sales',
  '/sales/overview',
  '/sales/customers',
  '/sales/orders',
  '/sales/invoices',
  '/accounting',
  '/accounting/overview',
  '/general-ledger/accounts',
  '/accounting/journal-entries',
  '/accounting/trial-balance',
  '/accounting/posting',
  '/reports',
  '/reports/financial',
  '/reports/inventory',
  '/reports/manufacturing',
  '/reports/sales',
];

// Smoke test each route using a shared login session
test.describe('Routes smoke — regular user', () => {
  // Single login before all; state is preserved via storageState below
  test.use({ storageState: { cookies: [], origins: [] } });

  let loggedIn = false;

  test.beforeAll(async ({ browser }) => {
    const skip = skipIfMissingEnv(['regularUser']);
    if (skip) return;

    const page = await browser.newPage();
    await loginAs(page, accounts.regularUser);
    loggedIn = true;
    // Save storage state so child tests reuse the session
    await page.context().storageState({ path: '/tmp/e2e-regular-user.json' });
    await page.close();
  });

  for (const route of ROUTES) {
    test(`${route} — loads without errors`, async ({ browser }) => {
      const skip = skipIfMissingEnv(['regularUser']);
      if (skip) { test.skip(true, skip); return; }
      if (!loggedIn) { test.skip(true, 'Login failed in beforeAll'); return; }

      const ctx = await browser.newContext({
        storageState: '/tmp/e2e-regular-user.json',
      });
      const page = await ctx.newPage();
      const { errors } = attachSupabaseErrorListener(page);

      await page.goto(route, { waitUntil: 'networkidle', timeout: 20_000 });

      // Must not be kicked to login (means auth still valid)
      await expect(page).not.toHaveURL(/\/login/);

      // No error boundary crash
      const body = page.locator('body');
      await expect(body).not.toContainText('Unexpected Application Error');
      await expect(body).not.toContainText('Something went wrong');

      // No Supabase 4xx/5xx
      expect(errors, `Supabase errors on ${route}: ${errors.join(', ')}`).toHaveLength(0);

      await ctx.close();
    });
  }
});
