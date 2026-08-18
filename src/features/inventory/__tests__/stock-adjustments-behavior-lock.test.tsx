import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
let currentOrgIdMock: string | null = 'org-1';
let currentUserMock: { id: string } | null = { id: 'user-1' };
let productUomStatusMock = {
  isEnabled: false,
  isLoading: false,
  isError: false,
  isSuccess: true,
  needsSetup: (_productId: string) => false,
};

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => ({ isEnabled: false }),
}));

vi.mock('@/hooks/use-product-uom-status', () => ({
  useProductUomStatus: () => productUomStatusMock,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: currentOrgIdMock, user: currentUserMock, isAuthenticated: Boolean(currentUserMock) }),
}));

vi.mock('@/services/supabase-service', () => ({
  itemsService: { getAll: vi.fn().mockResolvedValue([]) },
  categoriesService: { getAll: vi.fn().mockResolvedValue([]) },
  stockMovementsService: { getAll: vi.fn().mockResolvedValue([]) },
}));

const ADJUSTMENT = {
  id: 'adj-1',
  organization_id: 'org-1',
  status: 'DRAFT',
  adjustment_type: 'PHYSICAL_COUNT',
  adjustment_date: '2026-01-01',
  adjustment_number: 'ADJ-1',
  reason: 'Test adjustment',
  reference_number: 'REF-1',
  warehouse_id: 'wh-1',
  posting_date: '2026-01-01',
  increase_account_id: 'acct-inc',
  decrease_account_id: 'acct-dec',
  total_items: 1,
  requires_approval: false,
};

const ADJUSTMENT_ITEM = {
  id: 'item-1',
  product_id: 'p1',
  products: { id: 'p1', name: 'Widget', code: 'W-1' },
  warehouse_id: 'wh-1',
  current_qty: 10,
  new_qty: 12,
  difference_qty: 2,
  current_rate: 5,
  value_difference: 10,
  reason: '',
};

const DECREASE_ADJUSTMENT_ITEM = {
  ...ADJUSTMENT_ITEM,
  id: 'item-2',
  product_id: 'p2',
  products: { id: 'p2', name: 'Widget 2', code: 'W-2' },
  current_qty: 10,
  new_qty: 7,
  difference_qty: -3,
  current_rate: 5,
  value_difference: -15,
};

const PRODUCT = {
  id: 'p1',
  name: 'Widget',
  code: 'W-1',
  stock_quantity: 10,
  cost_price: 5,
};

const WAREHOUSE = {
  id: 'wh-1',
  org_id: 'org-1',
  code: 'MAIN',
  name: 'Main',
  is_active: true,
  inventory_account_id: 'acct-asset',
};

const GL_ACCOUNTS = [
  { id: 'acct-inc', code: '1100', name: 'Inventory increase', category: 'ASSET', is_active: true },
  { id: 'acct-dec', code: '5950', name: 'Inventory decrease', category: 'EXPENSE', is_active: true },
];

type QueryAction = 'select' | 'insert' | 'update' | 'delete';
type QueryResult = { data: any; error: any };
type QueryState = {
  table: string;
  action: QueryAction | null;
  payload?: any;
  filters: Array<[string, any]>;
};

const operationLog: string[] = [];
const writePayloads: Array<{ table: string; action: QueryAction; payload: any }> = [];
let getUserResult: { id: string } | null = { id: 'user-1' };
let adjustmentReadResult: any = ADJUSTMENT;
let adjustmentItemsReadResult: any[] = [ADJUSTMENT_ITEM];
let saveHeaderResult: QueryResult = { data: { ...ADJUSTMENT, id: 'adj-created' }, error: null };
let saveItemsResult: QueryResult = { data: null, error: null };
let editDeleteResult: QueryResult = { data: null, error: null };
let ledgerInsertResult: QueryResult = { data: null, error: null };
let submittedUpdateResult: QueryResult = { data: null, error: null };
let rpcResult: QueryResult = { data: { success: true }, error: null };

function resultFor(state: QueryState): QueryResult {
  const { table, action, payload } = state;
  if (action && action !== 'select') {
    operationLog.push(`${action}:${table}`);
    writePayloads.push({ table, action, payload });
  } else {
    operationLog.push(`select:${table}`);
  }

  if (table === 'stock_adjustments' && action === 'select') {
    return state.filters.some(([key]) => key === 'id')
      ? { data: adjustmentReadResult, error: null }
      : { data: adjustmentReadResult ? [adjustmentReadResult] : [], error: null };
  }
  if (table === 'stock_adjustments' && action === 'insert') return saveHeaderResult;
  if (table === 'stock_adjustments' && action === 'update') {
    return payload?.status === 'SUBMITTED' ? submittedUpdateResult : saveHeaderResult;
  }
  if (table === 'stock_adjustment_items' && action === 'select') {
    return { data: adjustmentItemsReadResult, error: null };
  }
  if (table === 'stock_adjustment_items' && action === 'delete') return editDeleteResult;
  if (table === 'stock_adjustment_items' && action === 'insert') return saveItemsResult;
  if (table === 'products' && action === 'select') return { data: [PRODUCT], error: null };
  if (table === 'warehouses' && action === 'select') {
    return state.filters.some(([key]) => key === 'id')
      ? { data: WAREHOUSE, error: null }
      : { data: [WAREHOUSE], error: null };
  }
  if (table === 'gl_accounts' && action === 'select') return { data: GL_ACCOUNTS, error: null };
  if (table === 'stock_ledger_entries' && action === 'insert') return ledgerInsertResult;
  return { data: [], error: null };
}

function createBuilder(table: string) {
  const state: QueryState = { table, action: null, filters: [] };
  const builder: any = {
    select: vi.fn(() => {
      if (!state.action) state.action = 'select';
      return builder;
    }),
    insert: vi.fn((payload: any) => {
      state.action = 'insert';
      state.payload = payload;
      return builder;
    }),
    update: vi.fn((payload: any) => {
      state.action = 'update';
      state.payload = payload;
      return builder;
    }),
    delete: vi.fn(() => {
      state.action = 'delete';
      return builder;
    }),
    eq: vi.fn((key: string, value: any) => {
      state.filters.push([key, value]);
      return builder;
    }),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(async () => {
      const result = resultFor(state);
      if (Array.isArray(result.data)) return { data: result.data[0] ?? null, error: result.error };
      return result;
    }),
    then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor(state)).then(resolve, reject),
  };
  return builder;
}

const fromSpy = vi.fn((table: string) => createBuilder(table));
const getUserSpy = vi.fn(async () => {
  operationLog.push('auth:getUser');
  return { data: { user: getUserResult } };
});
const rpcSpy = vi.fn(async (name: string, args: unknown) => {
  operationLog.push(`rpc:${name}`);
  return rpcResult;
});

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => fromSpy(table),
    auth: { getUser: () => getUserSpy() },
    rpc: (...args: [string, unknown]) => rpcSpy(...args),
  }),
}));

import { InventoryModule } from '../index';

const FULL_REF_PERMS = ['inventory.products.read', 'inventory.warehouses.read', 'accounting.accounts.read'] as const;

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function buildAdjustmentsElement() {
  return (
    <MemoryRouter initialEntries={['/inventory/adjustments']}>
      <Routes>
        <Route path="/inventory/*" element={<InventoryModule />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderAdjustments() {
  const rendered = render(buildAdjustmentsElement());
  return {
    ...rendered,
    // Mocked hooks (useAuth/usePermissions/useProductUomStatus) read mutable
    // module-level state, not React context. Passing the same element back
    // into RTL's rerender lets React bail out on referential prop equality
    // and skip re-invoking those hooks, so a mock mutated between renders
    // would never be observed. Building a fresh element per call forces
    // React to re-render and re-read the mocks.
    rerender: () => rendered.rerender(buildAdjustmentsElement()),
  };
}

async function openValidCreateForm() {
  setPermissions(['inventory.adjustments.read', 'inventory.adjustments.create', ...FULL_REF_PERMS]);
  const rendered = renderAdjustments();
  await userEvent.click(await screen.findByRole('button', { name: /تسوية جديدة/ }));

  await waitFor(() => expect(screen.getByLabelText('المخزن *')).toHaveValue('wh-1'));
  await waitFor(() => {
    expect(screen.getByLabelText('حساب الزيادة في المخزون *').querySelector('option[value="acct-inc"]')).not.toBeNull();
    expect(screen.getByLabelText('حساب النقص في المخزون *').querySelector('option[value="acct-dec"]')).not.toBeNull();
  });
  await userEvent.selectOptions(screen.getByLabelText('حساب الزيادة في المخزون *'), 'acct-inc');
  await userEvent.selectOptions(screen.getByLabelText('حساب النقص في المخزون *'), 'acct-dec');
  await userEvent.type(screen.getByLabelText('السبب *'), 'Behavior lock');

  const productSearch = screen.getByPlaceholderText('ابحث عن منتج...');
  await userEvent.type(productSearch, 'Widget');
  await userEvent.click(await screen.findByRole('button', { name: /Widget/ }));
  await userEvent.click(screen.getByRole('button', { name: 'إضافة' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'حفظ كمسودة' })).toBeEnabled());

  // A newly added item starts with new_qty=0 (difference_qty=0), which
  // validateAdjustmentForm() rejects. Set a real new quantity so the form
  // is actually valid before guard-ordering tests build on top of it.
  const newQtyInput = screen.getByRole('spinbutton');
  await userEvent.clear(newQtyInput);
  await userEvent.type(newQtyInput, '12');
  await waitFor(() => expect(newQtyInput).toHaveValue(12));

  return rendered;
}

async function openAdjustmentView() {
  setPermissions(['inventory.adjustments.read', 'inventory.adjustments.update', 'inventory.adjustments.approve', ...FULL_REF_PERMS]);
  const rendered = renderAdjustments();
  await userEvent.click(await screen.findByRole('button', { name: /عرض تفاصيل تسوية المخزون adj-1/ }));
  return rendered;
}


function expectIncreaseJournalRpcPayload() {
  expect(rpcSpy).toHaveBeenCalledTimes(1);
  expect(rpcSpy).toHaveBeenCalledWith('rpc_create_journal_entry', {
    p_payload: expect.objectContaining({
      org_id: 'org-1',
      reference_type: 'stock_adjustments',
      idempotency_key: 'stock-adj-adj-1',
      auto_post: true,
      lines: [
        {
          line_number: 1,
          account_id: 'acct-asset',
          debit: 10,
          credit: 0,
          description: 'زيادة مخزون - PHYSICAL_COUNT - REF-1',
        },
        {
          line_number: 2,
          account_id: 'acct-inc',
          debit: 0,
          credit: 10,
          description: 'زيادة مخزون - PHYSICAL_COUNT - REF-1',
        },
      ],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  operationLog.length = 0;
  writePayloads.length = 0;
  currentOrgIdMock = 'org-1';
  currentUserMock = { id: 'user-1' };
  getUserResult = { id: 'user-1' };
  productUomStatusMock = {
    isEnabled: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
    needsSetup: (_productId: string) => false,
  };
  adjustmentReadResult = { ...ADJUSTMENT };
  adjustmentItemsReadResult = [{ ...ADJUSTMENT_ITEM }];
  saveHeaderResult = { data: { ...ADJUSTMENT, id: 'adj-created' }, error: null };
  saveItemsResult = { data: null, error: null };
  editDeleteResult = { data: null, error: null };
  ledgerInsertResult = { data: null, error: null };
  submittedUpdateResult = { data: null, error: null };
  rpcResult = { data: { success: true }, error: null };
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('StockAdjustments — handleSaveAdjustment behavior lock', () => {
  it('re-checks create permission before validation/UoM/auth and performs zero writes after revocation', async () => {
    const { rerender } = await openValidCreateForm();
    operationLog.length = 0;
    writePayloads.length = 0;
    getUserSpy.mockClear();

    setPermissions(['inventory.adjustments.read', ...FULL_REF_PERMS]);
    rerender();
    await userEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }));

    expect(toast.error).toHaveBeenCalledWith('لا تملك صلاحية إنشاء تسويات مخزون');
    expect(getUserSpy).not.toHaveBeenCalled();
    expect(writePayloads).toHaveLength(0);
  });

  it('runs form validation before the UoM readiness guard and before auth/DB', async () => {
    const { rerender } = await openValidCreateForm();
    await userEvent.clear(screen.getByLabelText('السبب *'));
    productUomStatusMock = { ...productUomStatusMock, isEnabled: true, isSuccess: false };
    rerender();
    operationLog.length = 0;
    getUserSpy.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }));

    expect(toast.error).toHaveBeenCalledWith('الرجاء إدخال سبب التسوية');
    expect(toast.error).not.toHaveBeenCalledWith('جارٍ التحقق من إعداد وحدات الأصناف — أعد المحاولة بعد لحظات');
    expect(getUserSpy).not.toHaveBeenCalled();
    expect(writePayloads).toHaveLength(0);
  });

  it('blocks on UoM readiness before auth and before any DB write', async () => {
    const { rerender } = await openValidCreateForm();
    productUomStatusMock = { ...productUomStatusMock, isEnabled: true, isSuccess: false };
    rerender();
    operationLog.length = 0;
    getUserSpy.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }));

    expect(toast.error).toHaveBeenCalledWith('جارٍ التحقق من إعداد وحدات الأصناف — أعد المحاولة بعد لحظات');
    expect(getUserSpy).not.toHaveBeenCalled();
    expect(writePayloads).toHaveLength(0);
  });

  it('treats a missing authenticated user as a toast.error hard stop with zero writes', async () => {
    await openValidCreateForm();
    getUserResult = null;
    operationLog.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('الرجاء تسجيل الدخول'));
    expect(operationLog).toEqual(['auth:getUser']);
    expect(writePayloads).toHaveLength(0);
  });

  it('treats a missing active organization as a toast.error hard stop after auth with zero writes', async () => {
    const { rerender } = await openValidCreateForm();
    currentOrgIdMock = null;
    rerender();
    operationLog.length = 0;
    writePayloads.length = 0;
    getUserSpy.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('لم يتم تحديد المؤسسة النشطة'));
    expect(operationLog).toEqual(['auth:getUser']);
    expect(writePayloads).toHaveLength(0);
  });

  it('creates the DRAFT header before inserting items and preserves critical payload fields', async () => {
    await openValidCreateForm();
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('تم حفظ التسوية كمسودة بنجاح'));
    expect(operationLog.slice(0, 3)).toEqual([
      'auth:getUser',
      'insert:stock_adjustments',
      'insert:stock_adjustment_items',
    ]);

    const header = writePayloads.find((entry) => entry.table === 'stock_adjustments' && entry.action === 'insert')?.payload;
    expect(header).toEqual(expect.objectContaining({
      organization_id: 'org-1',
      status: 'DRAFT',
      created_by: 'user-1',
      warehouse_id: 'wh-1',
      increase_account_id: 'acct-inc',
      decrease_account_id: 'acct-dec',
      reason: 'Behavior lock',
      total_items: 1,
    }));

    const items = writePayloads.find((entry) => entry.table === 'stock_adjustment_items' && entry.action === 'insert')?.payload;
    expect(items).toEqual([
      expect.objectContaining({
        adjustment_id: 'adj-created',
        organization_id: 'org-1',
        product_id: 'p1',
        warehouse_id: 'wh-1',
      }),
    ]);
  });

  it('edit sequencing stays update header -> delete old items -> insert replacement items', async () => {
    await openAdjustmentView();
    await userEvent.click(screen.getByRole('button', { name: /تعديل/ }));
    await screen.findByRole('button', { name: /تحديث التسوية/ });
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /تحديث التسوية/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('تم تحديث التسوية بنجاح'));
    expect(operationLog.slice(0, 4)).toEqual([
      'auth:getUser',
      'update:stock_adjustments',
      'delete:stock_adjustment_items',
      'insert:stock_adjustment_items',
    ]);
  });

  it('does not insert replacement items when deletion fails after the header update', async () => {
    await openAdjustmentView();
    await userEvent.click(screen.getByRole('button', { name: /تعديل/ }));
    await screen.findByRole('button', { name: /تحديث التسوية/ });
    editDeleteResult = { data: null, error: new Error('delete failed') };
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /تحديث التسوية/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(operationLog.slice(0, 3)).toEqual([
      'auth:getUser',
      'update:stock_adjustments',
      'delete:stock_adjustment_items',
    ]);
    expect(writePayloads.filter((entry) => entry.table === 'stock_adjustment_items' && entry.action === 'insert')).toHaveLength(0);
  });
});

describe('StockAdjustments — handleSubmitAdjustment behavior lock', () => {
  it('treats a missing authenticated user as a toast.error hard stop before adjustment reads/SLE writes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAdjustmentView();
    getUserResult = null;
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('الرجاء تسجيل الدخول'));
    expect(operationLog).toEqual(['auth:getUser']);
    expect(writePayloads).toHaveLength(0);
  });

  it('treats a missing active organization as a toast.error hard stop after auth and before adjustment reads', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rerender } = await openAdjustmentView();
    currentOrgIdMock = null;
    rerender();
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('لم يتم تحديد المؤسسة النشطة'));
    expect(operationLog).toEqual(['auth:getUser']);
    expect(writePayloads).toHaveLength(0);
  });

  it('blocks a non-DRAFT adjustment before loading items or writing the stock ledger', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAdjustmentView();
    adjustmentReadResult = { ...ADJUSTMENT, status: 'SUBMITTED' };
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('يمكن فقط ترحيل التسويات بحالة مسودة'));
    expect(operationLog).toEqual(['auth:getUser', 'select:stock_adjustments']);
    expect(fromSpy).not.toHaveBeenCalledWith('stock_ledger_entries');
  });

  it('blocks when adjustment items are missing before UoM/warehouse/SLE work', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAdjustmentView();
    adjustmentItemsReadResult = [];
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('لم يتم العثور على بنود التسوية'));
    expect(operationLog).toEqual([
      'auth:getUser',
      'select:stock_adjustments',
      'select:stock_adjustment_items',
    ]);
    expect(fromSpy).not.toHaveBeenCalledWith('stock_ledger_entries');
  });

  it('blocks a DRAFT without warehouse after items/UoM checks and before the SLE write', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAdjustmentView();
    adjustmentReadResult = { ...ADJUSTMENT, warehouse_id: null };
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('لم يتم تحديد المخزن في التسوية'));
    expect(operationLog).toEqual([
      'auth:getUser',
      'select:stock_adjustments',
      'select:stock_adjustment_items',
    ]);
    expect(fromSpy).not.toHaveBeenCalledWith('stock_ledger_entries');
  });

  it('blocks UoM readiness after reading adjustment/items but before the SLE write', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rerender } = await openAdjustmentView();
    productUomStatusMock = { ...productUomStatusMock, isEnabled: true, isSuccess: false };
    rerender();
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('جارٍ التحقق من إعداد وحدات الأصناف — أعد المحاولة بعد لحظات'));
    expect(operationLog).toEqual([
      'auth:getUser',
      'select:stock_adjustments',
      'select:stock_adjustment_items',
    ]);
    expect(fromSpy).not.toHaveBeenCalledWith('stock_ledger_entries');
  });

  it('preserves SLE -> GL RPC -> SUBMITTED sequencing and critical payloads on success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAdjustmentView();
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('✅ تم ترحيل التسوية بنجاح وتحديث قيود المخزون'));
    expect(operationLog).toEqual(expect.arrayContaining([
      'insert:stock_ledger_entries',
      'rpc:rpc_create_journal_entry',
      'update:stock_adjustments',
    ]));
    expect(operationLog.indexOf('insert:stock_ledger_entries')).toBeLessThan(operationLog.indexOf('rpc:rpc_create_journal_entry'));
    expect(operationLog.indexOf('rpc:rpc_create_journal_entry')).toBeLessThan(operationLog.indexOf('update:stock_adjustments'));

    const ledger = writePayloads.find((entry) => entry.table === 'stock_ledger_entries' && entry.action === 'insert')?.payload;
    expect(ledger).toEqual([
      expect.objectContaining({
        org_id: 'org-1',
        voucher_type: 'Stock Adjustment',
        voucher_id: 'adj-1',
        product_id: 'p1',
        warehouse_id: 'wh-1',
        actual_qty: 2,
        qty_after_transaction: 12,
        incoming_rate: 5,
        outgoing_rate: 0,
        valuation_rate: 5,
        stock_value: 60,
        stock_value_difference: 10,
        is_cancelled: false,
        created_by: 'user-1',
      }),
    ]);

    expectIncreaseJournalRpcPayload();

    const submitted = writePayloads.find(
      (entry) => entry.table === 'stock_adjustments' && entry.action === 'update' && entry.payload?.status === 'SUBMITTED',
    )?.payload;
    expect(submitted).toEqual(expect.objectContaining({
      status: 'SUBMITTED',
      submitted_by: 'user-1',
      submitted_at: expect.any(String),
    }));
  });

  it('preserves increase/decrease GL line account direction, values, and line_number order 1 -> 4', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAdjustmentView();
    adjustmentItemsReadResult = [
      { ...ADJUSTMENT_ITEM },
      { ...DECREASE_ADJUSTMENT_ITEM },
    ];
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('✅ تم ترحيل التسوية بنجاح وتحديث قيود المخزون'));
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith('rpc_create_journal_entry', {
      p_payload: expect.objectContaining({
        lines: [
          {
            line_number: 1,
            account_id: 'acct-asset',
            debit: 10,
            credit: 0,
            description: 'زيادة مخزون - PHYSICAL_COUNT - REF-1',
          },
          {
            line_number: 2,
            account_id: 'acct-inc',
            debit: 0,
            credit: 10,
            description: 'زيادة مخزون - PHYSICAL_COUNT - REF-1',
          },
          {
            line_number: 3,
            account_id: 'acct-dec',
            debit: 15,
            credit: 0,
            description: 'نقص مخزون - PHYSICAL_COUNT - REF-1',
          },
          {
            line_number: 4,
            account_id: 'acct-asset',
            debit: 0,
            credit: 15,
            description: 'نقص مخزون - PHYSICAL_COUNT - REF-1',
          },
        ],
      }),
    });
  });

  it('GL/RPC failure warns, invokes rpc_create_journal_entry exactly once, and still marks the adjustment SUBMITTED', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAdjustmentView();
    rpcResult = { data: { success: false, error: 'GL rejected' }, error: null };
    operationLog.length = 0;
    writePayloads.length = 0;

    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('تم ترحيل التسوية لكن فشل إنشاء القيود المحاسبية')));
    await waitFor(() => expect(
      writePayloads.some((entry) => entry.table === 'stock_adjustments' && entry.action === 'update' && entry.payload?.status === 'SUBMITTED'),
    ).toBe(true));
    expectIncreaseJournalRpcPayload();
    expect(operationLog.indexOf('insert:stock_ledger_entries')).toBeLessThan(operationLog.indexOf('rpc:rpc_create_journal_entry'));
    expect(operationLog.indexOf('rpc:rpc_create_journal_entry')).toBeLessThan(operationLog.lastIndexOf('update:stock_adjustments'));
  });
});
