import { describe, expect, it } from 'vitest';
import {
  PRODUCT_CATALOG,
  getVisibleProductNavigation,
  type ProductCatalogAccessContext,
} from '../product-catalog';

function context(
  permissionKeys: readonly string[] = [],
  overrides: Partial<Pick<ProductCatalogAccessContext, 'isOrgAdmin' | 'isSuperAdmin'>> = {},
): ProductCatalogAccessContext {
  const keys = new Set(permissionKeys);
  return {
    isOrgAdmin: false,
    isSuperAdmin: false,
    hasPermissionKey: key => keys.has(key),
    ...overrides,
  };
}

function moduleByKey(navigation: ReturnType<typeof getVisibleProductNavigation>, key: string) {
  return navigation.find(item => item.key === key);
}

function childKeys(navigation: ReturnType<typeof getVisibleProductNavigation>, moduleKey: string): string[] {
  return moduleByKey(navigation, moduleKey)?.children?.map(item => item.key) ?? [];
}

describe('product catalog navigation', () => {
  it('keeps planned, hidden, and compatibility-only entries out of navigation', () => {
    const allKeys = [
      'inventory.items.read',
      'inventory.stock_moves.read',
      'inventory.warehouses.read',
      'inventory.adjustments.read',
      'manufacturing.orders.read',
      'manufacturing.boms.read',
      'manufacturing.stages.read',
      'manufacturing.work_centers.read',
      'manufacturing.stage_costs.read',
      'reports.financial.read',
      'reports.inventory.read',
      'reports.manufacturing.read',
      'reports.sales.read',
      'reports.ai_insights.use',
    ];
    const visible = getVisibleProductNavigation(context(allKeys));

    expect(childKeys(visible, 'inventory')).not.toContain('categories');
    expect(childKeys(visible, 'inventory')).not.toContain('bins');
    expect(childKeys(visible, 'manufacturing')).not.toContain('routing');
    expect(childKeys(visible, 'manufacturing')).not.toContain('quality');
    expect(childKeys(visible, 'reports')).not.toContain('gemini-compat');
  });

  it('uses exact child requirements instead of module-prefix access', () => {
    const visible = getVisibleProductNavigation(context(['inventory.adjustments.read']));

    expect(moduleByKey(visible, 'inventory')).toBeDefined();
    expect(childKeys(visible, 'inventory')).toEqual(['overview', 'adjustments']);
  });

  it('preserves allOf semantics for manufacturing efficiency', () => {
    const withoutOrders = getVisibleProductNavigation(
      context(['manufacturing.work_centers.read', 'manufacturing.stage_costs.read']),
    );
    expect(childKeys(withoutOrders, 'manufacturing')).not.toContain('efficiency');

    const complete = getVisibleProductNavigation(
      context([
        'manufacturing.work_centers.read',
        'manufacturing.stage_costs.read',
        'manufacturing.orders.read',
      ]),
    );
    expect(childKeys(complete, 'manufacturing')).toContain('efficiency');
  });

  it('keeps Accounting as one visible group for General Ledger-only access', () => {
    const visible = getVisibleProductNavigation(context(['general_ledger.chart_of_accounts.view']));

    expect(visible.filter(item => item.key === 'accounting')).toHaveLength(1);
    expect(childKeys(visible, 'accounting')).toEqual(['chart-of-accounts']);
    expect(visible.some(item => item.key === 'general-ledger')).toBe(false);
  });

  it('shows Reports from its root contract even though there is no /reports/overview route', () => {
    const visible = getVisibleProductNavigation(context(['reports.inventory.read']));

    expect(moduleByKey(visible, 'reports')).toBeDefined();
    // /reports/advanced accepts any of financial/inventory/manufacturing/sales
    // (REPORTS_ADVANCED in route-permissions.ts), so reports.inventory.read
    // alone satisfies both the /inventory and /advanced route contracts.
    expect(childKeys(visible, 'reports')).toEqual(['inventory', 'advanced']);
  });

  it('keeps admin surfaces behind their explicit admin flags', () => {
    const ordinary = getVisibleProductNavigation(context());
    expect(moduleByKey(ordinary, 'org-admin')).toBeUndefined();
    expect(moduleByKey(ordinary, 'super-admin')).toBeUndefined();

    const orgAdmin = getVisibleProductNavigation(context([], { isOrgAdmin: true }));
    expect(moduleByKey(orgAdmin, 'org-admin')).toBeDefined();
    expect(moduleByKey(orgAdmin, 'super-admin')).toBeUndefined();

    const superAdmin = getVisibleProductNavigation(context([], { isSuperAdmin: true }));
    expect(moduleByKey(superAdmin, 'org-admin')).toBeDefined();
    expect(moduleByKey(superAdmin, 'super-admin')).toBeDefined();
  });

  it('keeps Dashboard visible without inventing a permission key', () => {
    const visible = getVisibleProductNavigation(context());
    expect(moduleByKey(visible, 'dashboard')).toBeDefined();
    expect(childKeys(visible, 'dashboard')).toEqual(['overview', 'analytics', 'performance']);
  });

  it('contains no decorative badge field in the catalog contract', () => {
    for (const item of PRODUCT_CATALOG) {
      expect(item).not.toHaveProperty('badge');
      for (const child of item.children ?? []) expect(child).not.toHaveProperty('badge');
    }
  });

  describe('landingHref', () => {
    it('lands on the first visible child when the caller cannot enter the group root itself', () => {
      // general_ledger.chart_of_accounts.view satisfies /general-ledger/accounts
      // and (via be6706c) makes the Accounting group visible, but it does NOT
      // satisfy ACCOUNTING_OVERVIEW, the actual /accounting root contract —
      // so a collapsed-sidebar click must not send this caller to /accounting.
      const visible = getVisibleProductNavigation(context(['general_ledger.chart_of_accounts.view']));
      const accounting = moduleByKey(visible, 'accounting');

      expect(accounting?.children?.map(c => c.href)).toEqual(['/general-ledger/accounts']);
      expect(accounting?.landingHref).toBe('/general-ledger/accounts');
      expect(accounting?.landingHref).not.toBe(accounting?.href);
    });

    it('lands on the group root when the caller genuinely satisfies its own contract', () => {
      const visible = getVisibleProductNavigation(context(['accounting.journals.read']));
      const accounting = moduleByKey(visible, 'accounting');

      expect(accounting?.landingHref).toBe('/accounting');
      expect(accounting?.landingHref).toBe(accounting?.href);
    });

    it('lands on /settings directly for a caller with only settings.users.read, even though every visible child requires settings.organization.read', () => {
      // SETTINGS_OVERVIEW (route-permissions.ts) accepts settings.users.read on
      // its own, so the /settings root itself is reachable — even though none
      // of company/system/backup (all gated on settings.organization.read) are
      // visible. Before landingHref this rendered a childless parent whose
      // click did nothing.
      const visible = getVisibleProductNavigation(context(['settings.users.read']));
      const settings = moduleByKey(visible, 'settings');

      expect(settings).toBeDefined();
      expect(settings?.children).toEqual([]);
      expect(settings?.landingHref).toBe('/settings');
    });

    it('every visible group either satisfies its own root or has a visible child to land on', () => {
      const scenarios: ProductCatalogAccessContext[] = [
        context([]),
        context(['general_ledger.chart_of_accounts.view']),
        context(['settings.users.read']),
        context(['settings.roles.read']),
        context(['reports.inventory.read']),
        context(['manufacturing.work_centers.read', 'manufacturing.stage_costs.read', 'manufacturing.orders.read']),
        context([], { isOrgAdmin: true }),
        context([], { isSuperAdmin: true }),
      ];

      for (const scenario of scenarios) {
        for (const item of getVisibleProductNavigation(scenario)) {
          const landsOnRoot = item.landingHref === item.href;
          const hasVisibleChild = (item.children?.length ?? 0) > 0;
          expect(
            landsOnRoot || hasVisibleChild,
            `${item.key} landingHref=${item.landingHref} has no visible children to fall back to`,
          ).toBe(true);
        }
      }
    });
  });
});
