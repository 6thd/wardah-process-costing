// src/config/__tests__/route-permissions.test.ts
//
// عقد route-permissions هو ما يمنع مستخدمًا يملك صلاحية واحدة فقط داخل موديول
// (مثال العلة الأصلية: sales.receipts.read) من الوصول إلى شاشة أخرى في نفس
// الموديول (/sales/customers) لا يملك صلاحيتها الفعلية. هذه الاختبارات تثبت
// المطابقة الدقيقة لكل موديول، وأن أي مسار غير مربوط صراحة يفشل مغلقًا.

import { describe, it, expect } from 'vitest';
import { resolveRoutePermission, satisfiesRouteRequirement } from '../route-permissions';

describe('resolveRoutePermission — fail-closed contract', () => {
  it('returns undefined for a module with no registered contract', () => {
    expect(resolveRoutePermission('not_a_real_module', '/anything')).toBeUndefined();
  });

  it('a path with no specific pattern inside a KNOWN module is undefined, not the overview requirement', () => {
    // مراجعة مستقلة: wildcard كان يعيد متطلب overview لأي مسار غير مسجَّل داخل
    // موديول معروف — هذا ليس fail-closed، بل "أي مسار غير معروف يمر بصلاحية
    // النظرة العامة". المسار الوحيد المسموح هو ما سُجِّل صراحة.
    expect(resolveRoutePermission('sales', '/unknown-subpage')).toBeUndefined();
    expect(resolveRoutePermission('sales', '/definitely/not/a/real/route')).toBeUndefined();
  });

  describe('sales', () => {
    it('the concrete example from the P1 note: /sales/customers requires sales.customers.read', () => {
      expect(resolveRoutePermission('sales', '/customers')).toEqual({ key: 'sales.customers.read' });
    });

    it('/sales/receipts and /sales/collections both require sales.receipts.read, not customers.read', () => {
      expect(resolveRoutePermission('sales', '/receipts')).toEqual({ key: 'sales.receipts.read' });
      expect(resolveRoutePermission('sales', '/collections')).toEqual({ key: 'sales.receipts.read' });
    });

    it('/sales/orders and /sales/invoices require their own distinct resource keys', () => {
      expect(resolveRoutePermission('sales', '/orders')).toEqual({ key: 'sales.sales_orders.read' });
      expect(resolveRoutePermission('sales', '/invoices')).toEqual({ key: 'sales.sales_invoices.read' });
    });
  });

  describe('purchasing', () => {
    it('/purchasing/suppliers and /purchasing/payments require distinct keys', () => {
      expect(resolveRoutePermission('purchasing', '/suppliers')).toEqual({ key: 'purchasing.suppliers.read' });
      expect(resolveRoutePermission('purchasing', '/payments')).toEqual({ key: 'purchasing.payments.read' });
    });

    it('a supplier-only grant does not resolve the payments route to the same key', () => {
      const suppliers = resolveRoutePermission('purchasing', '/suppliers');
      const payments = resolveRoutePermission('purchasing', '/payments');
      expect(suppliers).not.toEqual(payments);
    });
  });

  describe('inventory', () => {
    it('/inventory/adjustments and /inventory/items require distinct keys', () => {
      expect(resolveRoutePermission('inventory', '/adjustments')).toEqual({ key: 'inventory.adjustments.read' });
      expect(resolveRoutePermission('inventory', '/items')).toEqual({ key: 'inventory.items.read' });
    });
  });

  describe('accounting', () => {
    it('/accounting/journal-entries requires the journals key, not a blanket accounting grant', () => {
      expect(resolveRoutePermission('accounting', '/journal-entries')).toEqual({ key: 'accounting.journals.read' });
    });

    it('module-level index resolves to an explicit anyOf, never an unconditional pass', () => {
      const overview = resolveRoutePermission('accounting', '/');
      expect(overview).toEqual({
        anyOf: ['accounting.journals.read', 'accounting.entries.read', 'accounting.accounts.read', 'accounting.cost_centers.read'],
      });
    });
  });

  describe('manufacturing — parametrized routes', () => {
    it('/manufacturing/bom/new requires create, distinct from viewing the list', () => {
      expect(resolveRoutePermission('manufacturing', '/bom/new')).toEqual({ key: 'manufacturing.boms.create' });
      expect(resolveRoutePermission('manufacturing', '/bom')).toEqual({ key: 'manufacturing.boms.read' });
    });

    it('/manufacturing/bom/:bomId/edit matches the param segment and requires update', () => {
      expect(resolveRoutePermission('manufacturing', '/bom/abc-123/edit')).toEqual({ key: 'manufacturing.boms.update' });
    });

    it('a bare /manufacturing/bom/:id (no /edit) has no registered contract — fails closed, not silently aliased to update', () => {
      // BOMManagement كانت تُنقّل صفوف الجدول إلى هذا المسار غير المسجَّل، فتُغرَق
      // في إعادة توجيه صامتة لصفحة النظرة العامة عبر <Route path="*">. القرار
      // المُتَّخذ: إزالة التنقّل المكسور بدل تسجيل مسار عرض جديد، فيبقى هذا
      // المسار بلا عقد صراحةً — أي تسجيل مستقبلي له يجب أن يفشل هذا الاختبار
      // عمدًا فيُراجَع القرار، لا أن ينزلق ضمنيًا إلى صلاحية manufacturing.boms.update.
      expect(resolveRoutePermission('manufacturing', '/bom/abc-123')).toBeUndefined();
    });
  });

  describe('hr', () => {
    it('/hr/employees/:id matches the param segment', () => {
      expect(resolveRoutePermission('hr', '/employees/emp-42')).toEqual({ key: 'hr.employees.read' });
    });
  });

  describe('settings — users/permissions are not organization', () => {
    it('/settings/users requires settings.users.read specifically', () => {
      expect(resolveRoutePermission('settings', '/users')).toEqual({ key: 'settings.users.read' });
    });

    it('/settings/permissions requires settings.roles.read specifically', () => {
      expect(resolveRoutePermission('settings', '/permissions')).toEqual({ key: 'settings.roles.read' });
    });

    it('organization.read is not among the keys that satisfy /settings/users or /settings/permissions', () => {
      const usersReq = resolveRoutePermission('settings', '/users');
      const permissionsReq = resolveRoutePermission('settings', '/permissions');
      const hasOrgOnly = (k: string) => k === 'settings.organization.read';

      expect(usersReq && satisfiesRouteRequirement(usersReq, hasOrgOnly)).toBe(false);
      expect(permissionsReq && satisfiesRouteRequirement(permissionsReq, hasOrgOnly)).toBe(false);
    });

    it('/settings/company and /settings/system stay on the organization key', () => {
      expect(resolveRoutePermission('settings', '/company')).toEqual({ key: 'settings.organization.read' });
      expect(resolveRoutePermission('settings', '/system')).toEqual({ key: 'settings.organization.read' });
    });
  });

  describe('settings — overview entry is anyOf, not organization.read alone', () => {
    // خلل جولة سابقة: مستخدم settings.users.read-only كان يُرفَض عند
    // ModuleGuard قبل الوصول إلى بطاقته الخاصة في SettingsOverview، لأن '/'
    // كانت تطلب settings.organization.read فقط.
    it('/ and /overview require anyOf(organization/users/roles), not organization.read alone', () => {
      const expected = {
        anyOf: ['settings.organization.read', 'settings.users.read', 'settings.roles.read'],
      };
      expect(resolveRoutePermission('settings', '/')).toEqual(expected);
      expect(resolveRoutePermission('settings', '/overview')).toEqual(expected);
    });

    it('a users-only or roles-only grant satisfies the overview entry requirement', () => {
      const overview = resolveRoutePermission('settings', '/');
      const usersOnly = (k: string) => k === 'settings.users.read';
      const rolesOnly = (k: string) => k === 'settings.roles.read';
      expect(overview && satisfiesRouteRequirement(overview, usersOnly)).toBe(true);
      expect(overview && satisfiesRouteRequirement(overview, rolesOnly)).toBe(true);
    });
  });
});

describe('inventory — overview entry includes adjustments.read', () => {
  // خلل جولة سابقة: adjustments.read غائب عن anyOf الدخول رغم أن
  // InventoryOverview تعرض بطاقة التسويات بمفتاحها بمعزل عن items/stock_moves/warehouses.
  it('/ and /overview accept an adjustments-only grant', () => {
    const overview = resolveRoutePermission('inventory', '/');
    const adjustmentsOnly = (k: string) => k === 'inventory.adjustments.read';
    expect(overview && satisfiesRouteRequirement(overview, adjustmentsOnly)).toBe(true);
    expect(resolveRoutePermission('inventory', '/overview')).toEqual(overview);
  });
});

describe('reports — overview entry includes ai_insights and purchasing fallback keys', () => {
  // خلل جولة سابقة: reports.ai_insights.use وpurchasing.purchase_orders.read/
  // purchasing.suppliers.read غائبة عن anyOf الدخول رغم أن ReportsOverview
  // تعرض بطاقات "رؤى التقارير الذكية"/"التحليلات المتقدمة"/"تقارير المشتريات"
  // بهذه المفاتيح بمعزل عن مفاتيح reports.* الأربعة الأساسية.
  it('/ accepts an ai_insights-only or purchasing-only grant', () => {
    const overview = resolveRoutePermission('reports', '/');
    const aiOnly = (k: string) => k === 'reports.ai_insights.use';
    const purchasingOnly = (k: string) => k === 'purchasing.suppliers.read';
    expect(overview && satisfiesRouteRequirement(overview, aiOnly)).toBe(true);
    expect(overview && satisfiesRouteRequirement(overview, purchasingOnly)).toBe(true);
  });

  it('/advanced stays on the four base report keys — an ai_insights-only grant does not satisfy it', () => {
    const advanced = resolveRoutePermission('reports', '/advanced');
    const aiOnly = (k: string) => k === 'reports.ai_insights.use';
    expect(advanced).toEqual({
      anyOf: ['reports.financial.read', 'reports.inventory.read', 'reports.manufacturing.read', 'reports.sales.read'],
    });
    expect(advanced && satisfiesRouteRequirement(advanced, aiOnly)).toBe(false);
  });

  it('/gemini requires the same key as /gemini/legacy — an ai_insights grant, not the broad overview anyOf', () => {
    expect(resolveRoutePermission('reports', '/gemini')).toEqual({ key: 'reports.ai_insights.use' });
    expect(resolveRoutePermission('reports', '/gemini/legacy')).toEqual({ key: 'reports.ai_insights.use' });
  });
});

describe('Round 7 P1: routing and categories fail closed — no defensible catalog resource', () => {
  it('/manufacturing/routing, /routing/new and /routing/:id are unregistered — no manufacturing.stages.* fallback', () => {
    // routingService.ts reads/writes `routings`, `routing_operations` and
    // `operation_resources` — tables unrelated to manufacturing_stages. No
    // manufacturing.routing.* key exists in the live catalog, so all three
    // routing sub-paths must resolve to undefined and fail closed via
    // ModuleGuard, for every user including org/super admins.
    expect(resolveRoutePermission('manufacturing', '/routing')).toBeUndefined();
    expect(resolveRoutePermission('manufacturing', '/routing/new')).toBeUndefined();
    expect(resolveRoutePermission('manufacturing', '/routing/some-id')).toBeUndefined();
  });

  it('a manufacturing.stages.read-only grant does not resolve /routing to anything', () => {
    const stagesOnly = (k: string) => k === 'manufacturing.stages.read';
    const requirement = resolveRoutePermission('manufacturing', '/routing');
    expect(requirement).toBeUndefined();
    // satisfiesRouteRequirement is not even reachable without a requirement
    // object — ModuleGuard's `requirement != null && satisfies(...)` check
    // short-circuits to false before ever consulting hasKey.
    expect(requirement == null || satisfiesRouteRequirement(requirement, stagesOnly)).toBe(true);
  });

  it('/inventory/categories is unregistered — no inventory.items.* fallback', () => {
    // categoriesService.ts reads/writes a standalone `categories` table
    // unrelated to items/products. No inventory.categories.* key exists.
    expect(resolveRoutePermission('inventory', '/categories')).toBeUndefined();
  });
});

describe('Round 7 P1: /manufacturing/efficiency reflects every real underlying resource', () => {
  it('resolves to anyOf across work_centers, stage_costs and orders — not a single approximated key', () => {
    expect(resolveRoutePermission('manufacturing', '/efficiency')).toEqual({
      anyOf: ['manufacturing.work_centers.read', 'manufacturing.stage_costs.read', 'manufacturing.orders.read'],
    });
  });

  it('a stage_costs-only grant (no work_centers.read) still satisfies /efficiency', () => {
    const requirement = resolveRoutePermission('manufacturing', '/efficiency');
    const stageCostsOnly = (k: string) => k === 'manufacturing.stage_costs.read';
    expect(requirement && satisfiesRouteRequirement(requirement, stageCostsOnly)).toBe(true);
  });
});

describe('satisfiesRouteRequirement', () => {
  it('a single-key requirement needs that exact key', () => {
    const hasKey = (k: string) => k === 'sales.customers.read';
    expect(satisfiesRouteRequirement({ key: 'sales.customers.read' }, hasKey)).toBe(true);
    expect(satisfiesRouteRequirement({ key: 'sales.receipts.read' }, hasKey)).toBe(false);
  });

  it('an anyOf requirement needs at least one of the listed keys', () => {
    const hasKey = (k: string) => k === 'sales.sales_orders.read';
    expect(
      satisfiesRouteRequirement({ anyOf: ['sales.customers.read', 'sales.sales_orders.read'] }, hasKey)
    ).toBe(true);
    expect(satisfiesRouteRequirement({ anyOf: ['sales.customers.read', 'sales.receipts.read'] }, hasKey)).toBe(false);
  });

  it('an allOf requirement needs every listed key, not just one', () => {
    const hasBoth = (k: string) => ['accounting.entries.read', 'accounting.accounts.read'].includes(k);
    const hasOnlyOne = (k: string) => k === 'accounting.entries.read';

    expect(
      satisfiesRouteRequirement({ allOf: ['accounting.entries.read', 'accounting.accounts.read'] }, hasBoth)
    ).toBe(true);
    expect(
      satisfiesRouteRequirement({ allOf: ['accounting.entries.read', 'accounting.accounts.read'] }, hasOnlyOne)
    ).toBe(false);
  });
});
