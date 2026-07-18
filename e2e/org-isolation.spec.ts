/**
 * T4 — Org isolation from the UI layer.
 *
 * Strategy: log in as Org A user and Org B user separately;
 * extract visible data identifiers from key list screens and
 * assert there is NO overlap (RLS + UI must be in sync).
 *
 * Requires env vars:
 *   E2E_USER_EMAIL / E2E_USER_PASSWORD          → user in Org A
 *   E2E_ORG_B_USER_EMAIL / E2E_ORG_B_USER_PASSWORD → user in Org B
 */

import { test, expect } from '@playwright/test';
import { accounts, loginAs, skipIfMissingEnv, attachSupabaseErrorListener } from './fixtures/auth';

// Routes and the selector that identifies individual data rows in each
const ISOLATION_CHECKS: Array<{ route: string; rowSelector: string; idAttr: string }> = [
  {
    route: '/manufacturing/orders',
    rowSelector: '[data-testid="order-row"], tr[data-id], [data-row-id]',
    idAttr: 'data-id',
  },
  {
    route: '/inventory/items',
    rowSelector: '[data-testid="item-row"], tr[data-id], [data-row-id]',
    idAttr: 'data-id',
  },
  {
    route: '/accounting/journal-entries',
    rowSelector: '[data-testid="entry-row"], tr[data-id], [data-row-id]',
    idAttr: 'data-id',
  },
  {
    route: '/sales/customers',
    rowSelector: '[data-testid="customer-row"], tr[data-id], [data-row-id]',
    idAttr: 'data-id',
  },
];

async function collectVisibleIds(
  browser: import('@playwright/test').Browser,
  storageStatePath: string,
  route: string,
  rowSelector: string,
  idAttr: string
): Promise<Set<string>> {
  const ctx = await browser.newContext({ storageState: storageStatePath });
  const page = await ctx.newPage();

  try {
    await page.goto(route, { waitUntil: 'networkidle', timeout: 20_000 });

    const rows = page.locator(rowSelector);
    const count = await rows.count();
    const ids = new Set<string>();

    for (let i = 0; i < count; i++) {
      const id = await rows.nth(i).getAttribute(idAttr);
      if (id) ids.add(id);
    }

    // Also capture any UUIDs in row text as a fallback (e.g. rendered in a hidden span)
    const allText = await page.locator('table, [role="table"], [data-testid$="-list"]').textContent();
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const uuids = allText?.match(uuidRegex) ?? [];
    uuids.forEach(u => ids.add(u.toLowerCase()));

    return ids;
  } finally {
    await ctx.close();
  }
}

test.describe('Org isolation — Org A vs Org B', () => {
  let orgAStatePath: string;
  let orgBStatePath: string;

  test.beforeAll(async ({ browser }) => {
    const skip = skipIfMissingEnv(['regularUser', 'orgBUser']);
    if (skip) return;

    // Login Org A user
    const pageA = await browser.newPage();
    await loginAs(pageA, accounts.regularUser);
    orgAStatePath = '/tmp/e2e-org-a.json';
    await pageA.context().storageState({ path: orgAStatePath });
    await pageA.close();

    // Login Org B user
    const pageB = await browser.newPage();
    await loginAs(pageB, accounts.orgBUser);
    orgBStatePath = '/tmp/e2e-org-b.json';
    await pageB.context().storageState({ path: orgBStatePath });
    await pageB.close();
  });

  for (const { route, rowSelector, idAttr } of ISOLATION_CHECKS) {
    test(`${route} — Org A data not visible to Org B user`, async ({ browser }) => {
      const skip = skipIfMissingEnv(['regularUser', 'orgBUser']);
      if (skip) { test.skip(true, skip); return; }

      const [idsA, idsB] = await Promise.all([
        collectVisibleIds(browser, orgAStatePath, route, rowSelector, idAttr),
        collectVisibleIds(browser, orgBStatePath, route, rowSelector, idAttr),
      ]);

      expect(
        idsA.size,
        `[isolation] ${route}: Org A returned 0 rows — seed data or fix the selector before running isolation checks`
      ).toBeGreaterThan(0);
      expect(
        idsB.size,
        `[isolation] ${route}: Org B returned 0 rows — seed data or fix the selector before running isolation checks`
      ).toBeGreaterThan(0);

      const leaked = [...idsA].filter(id => idsB.has(id));
      expect(
        leaked,
        `Data leak on ${route}: these IDs from Org A are visible to Org B user: ${leaked.join(', ')}`
      ).toHaveLength(0);
    });
  }

  test('Org B user gets no Supabase errors on key routes', async ({ browser }) => {
    const skip = skipIfMissingEnv(['orgBUser']);
    if (skip) { test.skip(true, skip); return; }

    const keyRoutes = ['/dashboard', '/manufacturing/orders', '/inventory/items'];

    for (const route of keyRoutes) {
      const ctx = await browser.newContext({ storageState: orgBStatePath });
      const page = await ctx.newPage();
      const { errors } = attachSupabaseErrorListener(page);

      await page.goto(route, { waitUntil: 'networkidle', timeout: 20_000 });

      expect(
        errors,
        `Supabase errors for Org B on ${route}: ${errors.join(', ')}`
      ).toHaveLength(0);

      await ctx.close();
    }
  });
});
