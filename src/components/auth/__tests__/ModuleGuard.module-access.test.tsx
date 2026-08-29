import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const usePermissionsMock = vi.fn();

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ModuleGuard } from '../ModuleGuard';

function mockPermissions(permissionKeys: readonly string[], overrides: Record<string, unknown> = {}) {
  usePermissionsMock.mockReturnValue({
    hasPermission: vi.fn(() => false),
    hasPermissionKey: (key: string) => permissionKeys.includes(key),
    isOrgAdmin: false,
    isSuperAdmin: false,
    loading: false,
    ...overrides,
  });
}

function renderAt(path: string, moduleCode: string, action?: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={`/${moduleCode.replace(/_/g, '-')}/*`}
          element={
            <ModuleGuard moduleCode={moduleCode} action={action}>
              <div>guarded-content</div>
            </ModuleGuard>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  usePermissionsMock.mockReset();
});

describe('ModuleGuard — per-route permission contract (P1: module access is not screen access)', () => {
  it(
    'the reported P1 example: a user with only sales.receipts.read reaches /sales/receipts ' +
      'but NOT /sales/customers',
    () => {
      mockPermissions(['sales.receipts.read']);

      renderAt('/sales/receipts', 'sales');
      expect(screen.getByText('guarded-content')).toBeInTheDocument();
    }
  );

  it('the same sales.receipts.read-only user is denied /sales/customers, not just menu-hidden', () => {
    mockPermissions(['sales.receipts.read']);

    renderAt('/sales/customers', 'sales');
    expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
  });

  it('a sales.customers.read-only user reaches /sales/customers but not /sales/receipts', () => {
    mockPermissions(['sales.customers.read']);

    renderAt('/sales/customers', 'sales');
    expect(screen.getByText('guarded-content')).toBeInTheDocument();
  });

  it('a sales.customers.read-only user is denied /sales/receipts', () => {
    mockPermissions(['sales.customers.read']);

    renderAt('/sales/receipts', 'sales');
    expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
  });

  it('purchasing: a suppliers-only grant does not reach /purchasing/payments', () => {
    mockPermissions(['purchasing.suppliers.read']);

    renderAt('/purchasing/payments', 'purchasing');
    expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
  });

  it('purchasing: the matching suppliers grant reaches /purchasing/suppliers', () => {
    mockPermissions(['purchasing.suppliers.read']);

    renderAt('/purchasing/suppliers', 'purchasing');
    expect(screen.getByText('guarded-content')).toBeInTheDocument();
  });

  it('inventory: an items-only grant does not reach /inventory/adjustments', () => {
    mockPermissions(['inventory.items.read']);

    renderAt('/inventory/adjustments', 'inventory');
    expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
  });

  it('inventory: the matching adjustments grant reaches /inventory/adjustments', () => {
    mockPermissions(['inventory.adjustments.read']);

    renderAt('/inventory/adjustments', 'inventory');
    expect(screen.getByText('guarded-content')).toBeInTheDocument();
  });

  it('accounting: a journals-only grant does not reach /accounting/trial-balance', () => {
    mockPermissions(['accounting.journals.read']);

    renderAt('/accounting/trial-balance', 'accounting');
    expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
  });

  it('accounting: an entries grant does not bypass financial-report permission', () => {
    mockPermissions(['accounting.entries.read']);

    renderAt('/accounting/trial-balance', 'accounting');
    expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
  });

  it('accounting: reports.financial.read reaches /accounting/trial-balance', () => {
    mockPermissions(['reports.financial.read']);

    renderAt('/accounting/trial-balance', 'accounting');
    expect(screen.getByText('guarded-content')).toBeInTheDocument();
  });

  it('fails closed with zero permissions even at the module overview route', () => {
    mockPermissions([]);

    renderAt('/sales', 'sales');
    expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
  });

  it('keeps an explicitly requested action narrower than — and independent of — the route contract', () => {
    const hasPermission = vi.fn(() => false);
    mockPermissions(['sales.sales_invoices.read'], { hasPermission });

    renderAt('/sales/invoices', 'sales', 'approve');

    expect(hasPermission).toHaveBeenCalledWith('sales', 'approve');
    expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
  });

  describe('settings — overview entry is anyOf(organization/users/roles), not organization.read alone', () => {
    // الخلل المُبلَّغ: '/' كانت تطلب settings.organization.read فقط، فمستخدم
    // users/roles-only يُرفَض عند ModuleGuard قبل الوصول لبطاقته الخاصة في
    // SettingsOverview — رغم أن الشاشة نفسها تعرض بطاقته حين يصل إليها.
    it('a settings.users.read-only grant now reaches /settings', () => {
      mockPermissions(['settings.users.read']);

      renderAt('/settings', 'settings');
      expect(screen.getByText('guarded-content')).toBeInTheDocument();
    });

    it('a settings.roles.read-only grant now reaches /settings', () => {
      mockPermissions(['settings.roles.read']);

      renderAt('/settings', 'settings');
      expect(screen.getByText('guarded-content')).toBeInTheDocument();
    });

    it('zero settings permissions still fails closed at /settings', () => {
      mockPermissions([]);

      renderAt('/settings', 'settings');
      expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
      expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
    });

    it('/settings/company still requires organization.read specifically — users-only does not reach it', () => {
      mockPermissions(['settings.users.read']);

      renderAt('/settings/company', 'settings');
      expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
      expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
    });
  });

  describe('inventory — overview entry includes adjustments.read', () => {
    // الخلل المُبلَّغ: adjustments.read غائب عن anyOf الدخول رغم أن
    // InventoryOverview تعرض بطاقة/رابط التسويات بمفتاحه المستقل.
    it('an adjustments-only grant now reaches /inventory', () => {
      mockPermissions(['inventory.adjustments.read']);

      renderAt('/inventory', 'inventory');
      expect(screen.getByText('guarded-content')).toBeInTheDocument();
    });
  });

  describe('reports — overview entry includes ai_insights and purchasing fallback keys', () => {
    // الخلل المُبلَّغ: reports.ai_insights.use وpurchasing.purchase_orders.read/
    // purchasing.suppliers.read غائبة عن anyOf الدخول رغم أن ReportsOverview
    // تعرض بطاقات مربوطة بها بمعزل عن مفاتيح reports.* الأربعة الأساسية.
    it('an ai_insights-only grant now reaches /reports', () => {
      mockPermissions(['reports.ai_insights.use']);

      renderAt('/reports', 'reports');
      expect(screen.getByText('guarded-content')).toBeInTheDocument();
    });

    it('a purchasing.suppliers.read-only grant now reaches /reports', () => {
      mockPermissions(['purchasing.suppliers.read']);

      renderAt('/reports', 'reports');
      expect(screen.getByText('guarded-content')).toBeInTheDocument();
    });

    it('an ai_insights-only grant still does NOT reach /reports/advanced (narrower, unchanged contract)', () => {
      mockPermissions(['reports.ai_insights.use']);

      renderAt('/reports/advanced', 'reports');
      expect(screen.queryByText('guarded-content')).not.toBeInTheDocument();
      expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
    });

    it('an ai_insights-only grant reaches /reports/gemini, aligned with /reports/gemini/legacy', () => {
      mockPermissions(['reports.ai_insights.use']);

      renderAt('/reports/gemini', 'reports');
      expect(screen.getByText('guarded-content')).toBeInTheDocument();
    });
  });
});
