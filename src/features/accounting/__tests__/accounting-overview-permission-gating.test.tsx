// src/features/accounting/__tests__/accounting-overview-permission-gating.test.tsx
//
// AccountingOverview كان يعرض كل accountingModules رغم أن الدخول anyOf، بما
// فيها بطاقات تقود إلى موديولات أخرى (general_ledger، reports) لا تُفحص
// صلاحيتها إطلاقًا. هذه الاختبارات تثبت أن كل بطاقة مربوطة بمتطلب مسارها.

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

import { AccountingModule } from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/accounting/*" element={<AccountingModule />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('AccountingOverview — cards bound to their exact route-permissions requirement', () => {
  it('accounting.journals.read alone shows Journal Entries but not General Ledger or Financial Reports', async () => {
    setPermissions(['accounting.journals.read']);
    renderAt('/accounting/overview');

    await waitFor(() => expect(screen.getByText('قيود اليومية')).toBeInTheDocument());
    expect(screen.queryByText('دليل الحسابات')).not.toBeInTheDocument();
    expect(screen.queryByText('التقارير المالية')).not.toBeInTheDocument();
    expect(screen.queryByText('ميزان المراجعة')).not.toBeInTheDocument();
  });

  it('general_ledger.chart_of_accounts.view alone shows Chart of Accounts only, not any accounting.* card', async () => {
    setPermissions(['general_ledger.chart_of_accounts.view']);
    renderAt('/accounting/overview');

    await waitFor(() => expect(screen.getByText('دليل الحسابات')).toBeInTheDocument());
    expect(screen.queryByText('قيود اليومية')).not.toBeInTheDocument();
    expect(screen.queryByText('التقارير المالية')).not.toBeInTheDocument();
  });

  it('reports.financial.read alone shows Financial Reports only', async () => {
    setPermissions(['reports.financial.read']);
    renderAt('/accounting/overview');

    await waitFor(() => expect(screen.getByText('التقارير المالية')).toBeInTheDocument());
    expect(screen.queryByText('قيود اليومية')).not.toBeInTheDocument();
    expect(screen.queryByText('دليل الحسابات')).not.toBeInTheDocument();
  });

  it('no permissions at all renders no module cards', async () => {
    setPermissions([]);
    renderAt('/accounting/overview');

    await waitFor(() => expect(screen.getByText('accountingHome.title')).toBeInTheDocument());
    expect(screen.queryByText('قيود اليومية')).not.toBeInTheDocument();
    expect(screen.queryByText('دليل الحسابات')).not.toBeInTheDocument();
    expect(screen.queryByText('التقارير المالية')).not.toBeInTheDocument();
  });
});
