// src/features/general-ledger/__tests__/general-ledger-permission-gating.test.tsx
//
// إضافة/تعديل/حذف حساب في ChartOfAccounts كانت متاحة لأي مستخدم يملك
// general_ledger.chart_of_accounts.view فقط، رغم وجود مفاتيح .create/.edit/
// .delete صريحة في الكتالوج (migration 55). هذه الاختبارات تثبت الفصل الفعلي.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const hasPermissionKeyMock = vi.fn((_key: string) => false);

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => hasPermissionKeyMock(key),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const getAllGLAccounts = vi.fn();
const createGLAccount = vi.fn();
const updateGLAccount = vi.fn();
const deleteGLAccount = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getAllGLAccounts: (...args: unknown[]) => getAllGLAccounts(...args),
  getEffectiveTenantId: vi.fn().mockResolvedValue('org-1'),
  createGLAccount: (...args: unknown[]) => createGLAccount(...args),
  updateGLAccount: (...args: unknown[]) => updateGLAccount(...args),
  deleteGLAccount: (...args: unknown[]) => deleteGLAccount(...args),
  checkAccountCodeExists: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/export-libs', () => ({
  loadXLSX: vi.fn(),
  loadJsPDF: vi.fn(),
}));

vi.mock('@/features/accounting/account-statement', () => ({
  AccountStatement: () => null,
}));

import { GeneralLedgerModule } from '../index';

const accounts = [
  { id: 'acc-1', code: '1000', name: 'Cash', name_ar: 'النقدية', category: 'ASSET', normal_balance: 'Debit', allow_posting: true, is_active: true },
];

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/general-ledger/*" element={<GeneralLedgerModule />} />
      </Routes>
    </MemoryRouter>
  );
}

function rerenderAt(rerender: (ui: Parameters<typeof render>[0]) => void, path: string) {
  rerender(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/general-ledger/*" element={<GeneralLedgerModule />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  getAllGLAccounts.mockResolvedValue(accounts);
});

describe('ChartOfAccounts — screen view vs. general_ledger.chart_of_accounts.create/.edit/.delete', () => {
  it('hides the add-account trigger with only .view', async () => {
    setPermissions(['general_ledger.chart_of_accounts.view']);
    renderAt('/general-ledger/accounts');

    await waitFor(() => expect(screen.getByText('1000')).toBeInTheDocument());
    expect(screen.queryByText('gl.addAccount')).not.toBeInTheDocument();
  });

  it('hides per-row edit/delete controls with only .view', async () => {
    setPermissions(['general_ledger.chart_of_accounts.view']);
    renderAt('/general-ledger/accounts');

    await waitFor(() => expect(screen.getByText('1000')).toBeInTheDocument());
    expect(screen.queryByTitle('gl.editAccountBtn')).not.toBeInTheDocument();
    expect(screen.queryByTitle('gl.deleteAccountBtn')).not.toBeInTheDocument();
  });

  it('an edit grant alone shows edit but not delete', async () => {
    setPermissions(['general_ledger.chart_of_accounts.view', 'general_ledger.chart_of_accounts.edit']);
    renderAt('/general-ledger/accounts');

    await waitFor(() => expect(screen.getByText('1000')).toBeInTheDocument());
    expect(screen.getByTitle('gl.editAccountBtn')).toBeInTheDocument();
    expect(screen.queryByTitle('gl.deleteAccountBtn')).not.toBeInTheDocument();
  });

  it('a delete grant alone shows delete but not edit', async () => {
    setPermissions(['general_ledger.chart_of_accounts.view', 'general_ledger.chart_of_accounts.delete']);
    renderAt('/general-ledger/accounts');

    await waitFor(() => expect(screen.getByText('1000')).toBeInTheDocument());
    expect(screen.getByTitle('gl.deleteAccountBtn')).toBeInTheDocument();
    expect(screen.queryByTitle('gl.editAccountBtn')).not.toBeInTheDocument();
  });

  it('revoking create mid-session (add modal already open) blocks the actual save', async () => {
    setPermissions(['general_ledger.chart_of_accounts.view', 'general_ledger.chart_of_accounts.create']);
    const { rerender } = renderAt('/general-ledger/accounts');
    await waitFor(() => expect(screen.getByText('1000')).toBeInTheDocument());

    await userEvent.click(screen.getByText('gl.addAccount'));
    const codeInput = await screen.findByPlaceholderText('gl.accountCode');
    await userEvent.type(codeInput, '2000');
    await userEvent.type(screen.getByPlaceholderText('gl.accountNameEn'), 'Bank');

    setPermissions(['general_ledger.chart_of_accounts.view']);
    rerenderAt(rerender, '/general-ledger/accounts');

    // النموذج نفسه يُغلَق فورًا مع سحب الصلاحية (isOpen يتحقق من modalType مقابل
    // create/edit)؛ لا يبقى سطح إدخال يمكن محاولة حفظه — إثبات سلبي حاسم.
    expect(screen.queryByPlaceholderText('gl.accountCode')).not.toBeInTheDocument();
    expect(createGLAccount).not.toHaveBeenCalled();
  });

  it('a full-permission user can create an account', async () => {
    createGLAccount.mockResolvedValue({ success: true });
    setPermissions([
      'general_ledger.chart_of_accounts.view',
      'general_ledger.chart_of_accounts.create',
    ]);
    renderAt('/general-ledger/accounts');
    await waitFor(() => expect(screen.getByText('1000')).toBeInTheDocument());

    await userEvent.click(screen.getByText('gl.addAccount'));
    await userEvent.type(await screen.findByPlaceholderText('gl.accountCode'), '2000');
    await userEvent.type(screen.getByPlaceholderText('gl.accountNameEn'), 'Bank');
    await userEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(createGLAccount).toHaveBeenCalled());
  });

  it('hides subaccount creation for a non-posting account without the create key', async () => {
    setPermissions(['general_ledger.chart_of_accounts.view']);
    renderAt('/general-ledger/accounts');

    await waitFor(() => expect(screen.getByText('1000')).toBeInTheDocument());
    expect(screen.queryByTitle('gl.addSubAccount')).not.toBeInTheDocument();
  });
});
