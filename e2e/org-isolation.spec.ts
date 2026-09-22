/**
 * T4 — tenant isolation at the authenticated Supabase boundary.
 *
 * The old version inferred isolation from UI row selectors that do not exist in
 * the live tables and waited for networkidle on pages with background traffic.
 * This version uses the exact access token + apikey emitted by each logged-in
 * browser session, then asks PostgREST for seeded tenant rows. The tokens are
 * kept only in memory and are never logged or attached to reports.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Request,
} from '@playwright/test';
import { accounts, loginAs, skipIfMissingEnv, attachSupabaseErrorListener } from './fixtures/auth';

const ISOLATION_TABLES = [
  'products',
  'manufacturing_orders',
  'gl_entries',
  'customers',
] as const;

interface SupabaseSessionHeaders {
  origin: string;
  apikey: string;
  authorization: string;
}

interface TenantRow {
  id: string;
  org_id: string;
}

function captureSupabaseSession(page: Page): Promise<SupabaseSessionHeaders> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off('request', onRequest);
      reject(new Error('No authenticated Supabase REST request observed after login'));
    }, 15_000);

    const onRequest = (request: Request) => {
      const url = new URL(request.url());
      if (!url.hostname.endsWith('.supabase.co') || !url.pathname.startsWith('/rest/v1/')) return;

      const headers = request.headers();
      const apikey = headers.apikey;
      const authorization = headers.authorization;
      if (!apikey || !authorization?.startsWith('Bearer ')) return;

      clearTimeout(timeout);
      page.off('request', onRequest);
      resolve({ origin: url.origin, apikey, authorization });
    };

    page.on('request', onRequest);
  });
}

async function loginAndCapture(
  page: Page,
  account: { email: string; password: string },
  storageStatePath: string,
): Promise<SupabaseSessionHeaders> {
  const captured = captureSupabaseSession(page);
  await loginAs(page, account);
  const sessionHeaders = await captured;
  await page.context().storageState({ path: storageStatePath });
  return sessionHeaders;
}

async function readTenantRows(
  request: APIRequestContext,
  session: SupabaseSessionHeaders,
  table: typeof ISOLATION_TABLES[number],
): Promise<TenantRow[]> {
  const response = await request.get(
    `${session.origin}/rest/v1/${table}?select=id%2Corg_id&order=id.asc`,
    {
      headers: {
        apikey: session.apikey,
        authorization: session.authorization,
        accept: 'application/json',
      },
    },
  );

  const body = await response.text();
  expect(
    response.ok(),
    `[isolation] ${table} PostgREST returned HTTP ${response.status()}: ${body.slice(0, 300)}`,
  ).toBe(true);

  return JSON.parse(body) as TenantRow[];
}

test.describe('Org isolation — Org A vs Org B', () => {
  let orgAStatePath: string;
  let orgBStatePath: string;
  let orgASession: SupabaseSessionHeaders;
  let orgBSession: SupabaseSessionHeaders;

  test.beforeAll(async ({ browser }) => {
    const skip = skipIfMissingEnv(['regularUser', 'orgBUser']);
    if (skip) return;

    orgAStatePath = '/tmp/e2e-org-a.json';
    const pageA = await browser.newPage();
    try {
      orgASession = await loginAndCapture(pageA, accounts.regularUser, orgAStatePath);
    } finally {
      await pageA.close();
    }

    orgBStatePath = '/tmp/e2e-org-b.json';
    const pageB = await browser.newPage();
    try {
      orgBSession = await loginAndCapture(pageB, accounts.orgBUser, orgBStatePath);
    } finally {
      await pageB.close();
    }
  });

  for (const table of ISOLATION_TABLES) {
    test(`${table} — authenticated tenants see disjoint seeded rows`, async ({ request }) => {
      const skip = skipIfMissingEnv(['regularUser', 'orgBUser']);
      if (skip) { test.skip(true, skip); return; }

      const [rowsA, rowsB] = await Promise.all([
        readTenantRows(request, orgASession, table),
        readTenantRows(request, orgBSession, table),
      ]);

      expect(rowsA.length, `[isolation] ${table}: Org A returned no seeded rows`).toBeGreaterThan(0);
      expect(rowsB.length, `[isolation] ${table}: Org B returned no seeded rows`).toBeGreaterThan(0);

      const orgIdsA = new Set(rowsA.map(row => row.org_id));
      const orgIdsB = new Set(rowsB.map(row => row.org_id));
      expect(orgIdsA.size, `[isolation] ${table}: Org A response spans multiple org_ids`).toBe(1);
      expect(orgIdsB.size, `[isolation] ${table}: Org B response spans multiple org_ids`).toBe(1);

      const [orgA] = [...orgIdsA];
      const [orgB] = [...orgIdsB];
      expect(orgA).toBeTruthy();
      expect(orgB).toBeTruthy();
      expect(orgA, `[isolation] ${table}: both sessions resolved to the same tenant`).not.toBe(orgB);

      const idsA = new Set(rowsA.map(row => row.id));
      const leaked = rowsB.map(row => row.id).filter(id => idsA.has(id));
      expect(
        leaked,
        `Data leak on ${table}: Org A row ids visible to Org B: ${leaked.join(', ')}`,
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

      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await expect(page.locator('[data-testid="user-menu"]').first()).toBeVisible({ timeout: 10_000 });
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);

        expect(
          errors,
          `Supabase errors for Org B on ${route}: ${errors.join(', ')}`,
        ).toHaveLength(0);
      } finally {
        await ctx.close();
      }
    }
  });
});
