import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const usePermissionsMock = vi.fn();
const fetchDashboardMock = vi.fn();
const fetchCountsMock = vi.fn();

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('@/services/dashboard-data-service', () => ({
  fetchRealDashboardData: () => fetchDashboardMock(),
  fetchOperationalCounts: () => fetchCountsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'dashboard.title': 'لوحة المعلومات',
      'dashboard.metrics.totalInventoryValue': 'إجمالي قيمة المخزون',
      'dashboard.metrics.totalSales': 'إجمالي المبيعات',
      'dashboard.metrics.totalProductionCost': 'إجمالي تكلفة الإنتاج',
      'dashboard.metrics.grossProfitMargin': 'هامش الربح الإجمالي',
      'dashboard.recentActivities': 'النشاطات الأخيرة',
      'dashboard.quickActions': 'الإجراءات السريعة',
    }[key] ?? key),
    i18n: { language: 'ar' },
  }),
}));

import { DashboardOverview } from '../dashboard-overview';

const DASHBOARD_DATA = {
  kpis: {
    totalSales: 100,
    totalCosts: 40,
    netProfit: 60,
    grossProfit: 60,
    inventoryValue: 50,
    totalAssets: 0,
    totalLiabilities: 0,
    equity: 0,
    profitMargin: 60,
    revenueGrowth: 0,
    operationalEfficiency: 60,
  },
  charts: {
    revenue: [80, 100],
    costs: [30, 40],
    profit: [50, 60],
    months: ['1', '2'],
  },
  recentTransactions: [
    {
      id: 'invoice-1',
      invoice_number: 'SI-1',
      total_amount: 100,
      invoice_date: '2026-08-01',
      customer: { name: 'عميل' },
    },
  ],
  topProducts: [],
};

function renderDashboard() {
  render(
    <MemoryRouter>
      <DashboardOverview />
    </MemoryRouter>
  );
}

describe('DashboardOverview — permission-aware surface', () => {
  beforeEach(() => {
    fetchDashboardMock.mockReset();
    fetchCountsMock.mockReset();
    usePermissionsMock.mockReset();
    fetchDashboardMock.mockResolvedValue(DASHBOARD_DATA);
    fetchCountsMock.mockResolvedValue({
      activeManufacturingOrders: 2,
      pendingPurchaseOrders: 3,
      totalCustomers: 4,
      totalVendors: 5,
    });
  });

  it('shows sales information but hides unrelated modules and ungranted create actions', async () => {
    usePermissionsMock.mockReturnValue({
      hasModuleAccess: (moduleCode: string) => moduleCode === 'sales',
      hasPermissionKey: () => false,
    });

    renderDashboard();

    await waitFor(() => expect(screen.getByText('إجمالي المبيعات')).toBeInTheDocument());
    expect(screen.getByText('فاتورة مبيعات SI-1')).toBeInTheDocument();
    expect(screen.queryByText('إجمالي قيمة المخزون')).not.toBeInTheDocument();
    expect(screen.queryByText('أوامر التصنيع النشطة')).not.toBeInTheDocument();
    expect(screen.queryByText('فاتورة مبيعات', { exact: true })).not.toBeInTheDocument();
  });

  it('shows only the quick action backed by the exact granted key', async () => {
    usePermissionsMock.mockReturnValue({
      hasModuleAccess: (moduleCode: string) => moduleCode === 'inventory',
      hasPermissionKey: (key: string) => key === 'inventory.items.create',
    });

    renderDashboard();

    await waitFor(() => expect(screen.getByText('إضافة صنف جديد')).toBeInTheDocument());
    expect(screen.queryByText('تسوية مخزون')).not.toBeInTheDocument();
    expect(screen.queryByText('فاتورة مبيعات', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('النشاطات الأخيرة')).not.toBeInTheDocument();
  });
});
