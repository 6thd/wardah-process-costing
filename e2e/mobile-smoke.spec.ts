/**
 * T4 — Mobile smoke test (390×844 — iPhone 14 Pro viewport)
 * Top 5 most-used routes: no crash, no horizontal overflow, sidebar usable.
 */

import { test, expect } from '@playwright/test';
import { accounts, loginAs, skipIfMissingEnv, attachSupabaseErrorListener } from './fixtures/auth';

test.use({
  viewport: { width: 390, height: 844 },
});

const MOBILE_ROUTES = [
  '/dashboard',
  '/manufacturing/orders',
  '/inventory/items',
  '/accounting/journal-entries',
  '/sales/orders',
];

test.describe('Mobile smoke (390×844)', () => {
  let storageStatePath: string;

  test.beforeAll(async ({ browser }) => {
    const skip = skipIfMissingEnv(['regularUser']);
    if (skip) return;

    const page = await browser.newPage();
    await loginAs(page, accounts.regularUser);
    storageStatePath = '/tmp/e2e-mobile.json';
    await page.context().storageState({ path: storageStatePath });
    await page.close();
  });

  for (const route of MOBILE_ROUTES) {
    test(`${route} — renders on mobile without crash`, async ({ browser }) => {
      const skip = skipIfMissingEnv(['regularUser']);
      if (skip) { test.skip(true, skip); return; }

      const ctx = await browser.newContext({
        storageState: storageStatePath,
        viewport: { width: 390, height: 844 },
      });
      const page = await ctx.newPage();
      const { errors } = attachSupabaseErrorListener(page);

      await page.goto(route, { waitUntil: 'networkidle', timeout: 20_000 });

      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator('body')).not.toContainText('Unexpected Application Error');

      // No Supabase errors
      expect(errors, `Supabase errors on mobile ${route}: ${errors.join(', ')}`).toHaveLength(0);

      // No horizontal scrollbar on body (overflow-x)
      const hasHorizOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizOverflow, `Horizontal overflow on mobile ${route}`).toBe(false);

      await ctx.close();
    });
  }

  test('hamburger opens sidebar navigation on mobile', async ({ browser }) => {
    const skip = skipIfMissingEnv(['regularUser']);
    if (skip) { test.skip(true, skip); return; }

    const ctx = await browser.newContext({
      storageState: storageStatePath,
      viewport: { width: 390, height: 844 },
    });
    const page = await ctx.newPage();

    await page.goto('/dashboard', { waitUntil: 'networkidle', timeout: 20_000 });

    // The hamburger toggle must be visible before interaction
    const toggle = page.locator(
      '[data-testid="sidebar-toggle"], button[aria-label*="menu"], button[aria-label*="sidebar"]'
    );
    await expect(toggle.first()).toBeVisible();

    // Click it — the sidebar nav must become visible
    await toggle.first().click();

    // At least one navigation link must now appear in the viewport
    const navLink = page.locator('nav a, [role="navigation"] a').first();
    await expect(navLink).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });
});
