import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GLAccount } from '@/lib/supabase';
import { saveGeneralLedgerAccount } from '../helpers/saveAccount';

const selectedAccount: GLAccount = {
  id: 'account-1',
  code: '1000',
  name: 'Cash',
  name_ar: 'النقدية',
  name_en: 'Cash',
  category: 'ASSET',
  normal_balance: 'Debit',
  allow_posting: true,
  is_active: true,
  org_id: 'org-1',
};

const formData: Partial<GLAccount> = {
  code: '2000',
  name: 'Bank',
  name_ar: 'البنك',
  name_en: 'Bank',
  category: 'ASSET',
  parent_id: 'parent-1',
  is_active: true,
};

const getEffectiveTenantId = vi.fn();
const checkAccountCodeExists = vi.fn();
const createGLAccount = vi.fn();
const updateGLAccount = vi.fn();
const t = vi.fn((key: string, options?: Record<string, unknown>) => (
  options?.code ? `${key}:${options.code}` : key
));

const dependencies = {
  getEffectiveTenantId,
  checkAccountCodeExists,
  createGLAccount,
  updateGLAccount,
};

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveTenantId.mockResolvedValue('org-1');
  checkAccountCodeExists.mockResolvedValue(false);
  createGLAccount.mockResolvedValue({ success: true });
  updateGLAccount.mockResolvedValue({ success: true });
});

describe('saveGeneralLedgerAccount', () => {
  it('fails before validation or persistence when the active organization is missing', async () => {
    getEffectiveTenantId.mockResolvedValue(null);

    await expect(saveGeneralLedgerAccount({ formData, modalType: 'add', selectedAccount: null, t }, dependencies))
      .rejects.toThrow('gl.orgIdNotFound');
    expect(checkAccountCodeExists).not.toHaveBeenCalled();
    expect(createGLAccount).not.toHaveBeenCalled();
  });

  it('rejects missing required fields before checking duplicate codes', async () => {
    const outcome = await saveGeneralLedgerAccount(
      { formData: { code: '2000' }, modalType: 'add', selectedAccount: null, t },
      dependencies,
    );

    expect(outcome).toEqual({ status: 'rejected', message: 'gl.requiredFields' });
    expect(checkAccountCodeExists).not.toHaveBeenCalled();
  });

  it('rejects a duplicate create code using the existing tenant argument contract', async () => {
    checkAccountCodeExists.mockResolvedValue(true);

    const outcome = await saveGeneralLedgerAccount(
      { formData, modalType: 'add', selectedAccount: null, t },
      dependencies,
    );

    expect(checkAccountCodeExists).toHaveBeenCalledWith('2000', 'org-1');
    expect(outcome).toEqual({ status: 'rejected', message: 'gl.duplicateCode:2000' });
    expect(createGLAccount).not.toHaveBeenCalled();
  });

  it('creates the exact existing payload and defaults an undefined active flag to true', async () => {
    const outcome = await saveGeneralLedgerAccount(
      {
        formData: { ...formData, parent_id: undefined, is_active: undefined },
        modalType: 'add',
        selectedAccount: null,
        t,
      },
      dependencies,
    );

    expect(createGLAccount).toHaveBeenCalledWith({
      code: '2000',
      name: 'Bank',
      name_ar: 'البنك',
      name_en: 'Bank',
      account_type: 'ASSET',
      parent_id: null,
      is_active: true,
    });
    expect(updateGLAccount).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'saved', message: 'gl.createdSuccess' });
  });

  it('updates the exact existing payload and skips duplicate lookup when the code is unchanged', async () => {
    const outcome = await saveGeneralLedgerAccount(
      {
        formData: { ...formData, code: selectedAccount.code },
        modalType: 'edit',
        selectedAccount,
        t,
      },
      dependencies,
    );

    expect(checkAccountCodeExists).not.toHaveBeenCalled();
    expect(updateGLAccount).toHaveBeenCalledWith({
      id: 'account-1',
      code: '1000',
      name: 'Bank',
      name_ar: 'البنك',
      name_en: 'Bank',
      account_type: 'ASSET',
      parent_id: 'parent-1',
      is_active: true,
    });
    expect(outcome).toEqual({ status: 'saved', message: 'gl.updatedSuccess' });
  });

  it('checks a changed edit code before updating', async () => {
    await saveGeneralLedgerAccount(
      { formData: { ...formData, parent_id: undefined }, modalType: 'edit', selectedAccount, t },
      dependencies,
    );

    expect(checkAccountCodeExists).toHaveBeenCalledWith('2000', 'org-1');
    expect(updateGLAccount).toHaveBeenCalledWith(expect.objectContaining({ parent_id: null }));
  });

  it.each([
    ['add', null, createGLAccount, 'Create failed'],
    ['edit', selectedAccount, updateGLAccount, 'Update failed'],
  ] as const)('propagates the existing fallback error for a failed %s result', async (
    modalType,
    account,
    persistenceMock,
    expectedMessage,
  ) => {
    persistenceMock.mockResolvedValueOnce({ success: false });

    await expect(saveGeneralLedgerAccount(
      { formData, modalType, selectedAccount: account, t },
      dependencies,
    )).rejects.toThrow(expectedMessage);
  });
});
