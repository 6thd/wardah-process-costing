/**
 * T4 — Smoke test: every main sidebar route loads without
 * Supabase 4xx/5xx errors, without a 404 response, and without
 * an error-boundary crash screen.
 *
 * Routes are auto-extracted from src/components/layout/sidebar.tsx so
 * this test stays in sync when routes are added or removed.
 *
 * Logged in as regularUser. Org-admin and super-admin routes
 * are skipped for this role (covered in auth-roles.spec.ts).
 */

import { test, expect } from '@playwright/test';
import { accounts, loginAs, skipIfMissingEnv, attachSupabaseErrorListener } from './fixtures/auth';
import { extractSidebarRoutes } from './fixtures/sidebar-routes';

const ROUTES = extractSidebarRoutes();

// Smoke test each route using a shared login session
test.describe('Routes smoke — regular user', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let loggedIn = false;

  test.beforeAll(async ({ browser }) => {
    const skip = skipIfMissingEnv(['regularUser']);
    if (skip) return;

    const page = await browser.newPage();
    await loginAs(page, accounts.regularUser);
    loggedIn = true;
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

      // Intercept page-level 404 responses (not API — those are caught separately)
      const notFound: string[] = [];
      page.on('response', res => {
        if (res.status() === 404 && res.url().includes(page.url().split('?')[0])) {
          notFound.push(res.url());
        }
      });

      await page.goto(route, { waitUntil: 'networkidle', timeout: 20_000 });

      // Must not be kicked to login
      await expect(page).not.toHaveURL(/\/login/);

      // No error boundary crash
      const body = page.locator('body');
      await expect(body).not.toContainText('Unexpected Application Error');
      await expect(body).not.toContainText('Something went wrong');

      // No inline "404 Not Found" page rendered by the SPA router
      await expect(body).not.toContainText('404');

      // No Supabase 4xx/5xx
      expect(errors, `Supabase errors on ${route}: ${errors.join(', ')}`).toHaveLength(0);

      await ctx.close();
    });
  }
});
