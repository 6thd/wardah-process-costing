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
