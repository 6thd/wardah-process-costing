// src/features/reports/__tests__/reports-overview-permission-gating.test.tsx
//
// ReportsOverview كان يعرض كل reportCategories لأي مستخدم يملك مفتاح تقرير
// واحدًا فقط. هذه الاختبارات تثبت أن كل بطاقة مربوطة بمتطلب مسارها الفعلي،
// بما فيها إخفاء AI Insights بلا reports.ai_insights.use.

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => hasPermissionKeyMock(key),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}));

import { ReportsModule } from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports/*" element={<ReportsModule />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('ReportsOverview — cards bound to their exact route-permissions requirement', () => {
  it('reports.sales.read alone shows only the sales report card', async () => {
    setPermissions(['reports.sales.read']);
    renderAt('/reports');

    await waitFor(() => expect(screen.getByText('تقارير المبيعات')).toBeInTheDocument());
    expect(screen.queryByText('التقارير المالية')).not.toBeInTheDocument();
    expect(screen.queryByText('رؤى التقارير الذكية')).not.toBeInTheDocument();
    expect(screen.queryByText('التحليلات المتقدمة')).not.toBeInTheDocument();
  });

  it('hides AI Insights (both cards) without reports.ai_insights.use', async () => {
    setPermissions(['reports.financial.read', 'reports.inventory.read', 'reports.manufacturing.read', 'reports.sales.read']);
    renderAt('/reports');

    await waitFor(() => expect(screen.getByText('التقارير المالية')).toBeInTheDocument());
    expect(screen.queryByText('رؤى التقارير الذكية')).not.toBeInTheDocument();
    expect(screen.queryByText('التحليلات المتقدمة')).not.toBeInTheDocument();
    // "التقارير المتقدمة" (advanced) تحتاج anyOf المالية/المخزون/التصنيع/المبيعات — تبقى ظاهرة
    expect(screen.getByText('التقارير المتقدمة')).toBeInTheDocument();
  });

  it('reports.ai_insights.use alone shows only the two AI-insights cards', async () => {
    setPermissions(['reports.ai_insights.use']);
    renderAt('/reports');

    await waitFor(() => expect(screen.getByText('رؤى التقارير الذكية')).toBeInTheDocument());
    expect(screen.getByText('التحليلات المتقدمة')).toBeInTheDocument();
    expect(screen.queryByText('التقارير المالية')).not.toBeInTheDocument();
    expect(screen.queryByText('تقارير المبيعات')).not.toBeInTheDocument();
  });

  it('does not show the purchasing report link without its own purchasing read key', async () => {
    setPermissions(['reports.sales.read']);
    renderAt('/reports');

    await waitFor(() => expect(screen.getByText('تقارير المبيعات')).toBeInTheDocument());
    expect(screen.queryByText('تقارير المشتريات')).not.toBeInTheDocument();
  });

  it('a purchasing.suppliers.read grant alone shows the purchasing report card', async () => {
    setPermissions(['purchasing.suppliers.read']);
    renderAt('/reports');

    await waitFor(() => expect(screen.getByText('تقارير المشتريات')).toBeInTheDocument());
    expect(screen.queryByText('تقارير المبيعات')).not.toBeInTheDocument();
  });
});
