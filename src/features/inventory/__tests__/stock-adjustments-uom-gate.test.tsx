/**
 * Stock Adjustments — fail-closed UoM gate on save/post.
 *
 * Exercises the picker states (loading / error / unmapped row / selectable) and,
 * most importantly, the fresh server re-validation that runs immediately before a
 * draft is written or posted. The gate must read the current status from the
 * server (validateAdjustmentProductUoms) rather than trust the cached picker
 * projection, so these tests drive the picker with a MAPPED product yet still
 * block the write when the fresh read reports the product as unmapped.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  validateAdjustmentProductUoms: vi.fn(),
  itemsGetAll: vi.fn(),
  getSupabase: vi.fn(),
  uomStatus: {
    isEnabled: true,
    isLoading: false,
    isError: false,
    isSuccess: true,
    needsSetup: (_id: string) => false,
    statusById: new Map<string, string>(),
  } as {
    isEnabled: boolean
    isLoading: boolean
    isError: boolean
    isSuccess: boolean
    needsSetup: (id: string) => boolean
    statusById: Map<string, string>
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}))

vi.mock('sonner', () => ({ toast: h.toast }))

vi.mock('@/hooks/use-product-uom-status', () => ({
  useProductUomStatus: () => h.uomStatus,
}))

vi.mock('@/services/uom-master-data-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/uom-master-data-service')>()),
  validateAdjustmentProductUoms: (...args: unknown[]) => h.validateAdjustmentProductUoms(...args),
}))

vi.mock('@/services/supabase-service', () => ({
  itemsService: { getAll: (...args: unknown[]) => h.itemsGetAll(...args) },
  categoriesService: { getAll: vi.fn().mockResolvedValue([]) },
  stockMovementsService: { getAll: vi.fn().mockResolvedValue([]) },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  },
  getSupabase: (...args: unknown[]) => h.getSupabase(...args),
  getEffectiveTenantId: vi.fn().mockResolvedValue('org-1'),
}))

import { InventoryModule } from '../index'

type TableResult = { list?: { data: unknown; error: unknown }; single?: { data: unknown; error: unknown } }
let tableResults: Record<string, TableResult> = {}

function makeQuery(table: string) {
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'or', 'order', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  const result = tableResults[table] ?? {}
  const listResult = result.list ?? { data: [], error: null }
  const singleResult = result.single ?? { data: null, error: null }
  query.single = vi.fn(() => Promise.resolve(singleResult))
  query.maybeSingle = vi.fn(() => Promise.resolve(singleResult))
  ;(query as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(listResult).then(onFulfilled, onRejected)
  return query
}

function resetTables() {
  tableResults = {
    user_organizations: { single: { data: { org_id: 'org-1' }, error: null } },
    stock_adjustments: { list: { data: [], error: null }, single: { data: { id: 'adj-1' }, error: null } },
    stock_adjustment_items: { list: { data: [], error: null } },
    stock_ledger_entries: { list: { data: [], error: null } },
    warehouses: { list: { data: [{ id: 'w1', code: 'W1', name: 'Warehouse 1' }], error: null } },
    gl_accounts: {
      list: {
        data: [
          { id: 'acc-asset', code: '1100', name: 'Inventory', category: 'ASSET', is_active: true },
          { id: 'acc-exp', code: '5100', name: 'Loss', category: 'EXPENSE', is_active: true },
        ],
        error: null,
      },
    },
  }
}

function renderAdjustments() {
  return render(
    <MemoryRouter initialEntries={['/inventory/adjustments']}>
      <Routes>
        <Route path="/inventory/*" element={<InventoryModule />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openNewForm() {
  renderAdjustments()
  const newButton = await screen.findByRole('button', { name: 'تسوية جديدة' })
  fireEvent.click(newButton)
  // Warehouse auto-selects to the first loaded warehouse.
  await screen.findByLabelText('المخزن *')
}

function searchAndOpenPicker(term: string) {
  const search = screen.getByPlaceholderText('ابحث عن منتج...')
  fireEvent.focus(search)
  fireEvent.change(search, { target: { value: term } })
}

async function fillValidHeader() {
  fireEvent.change(screen.getByLabelText('حساب الزيادة في المخزون *'), { target: { value: 'acc-asset' } })
  fireEvent.change(screen.getByLabelText('حساب النقص في المخزون *'), { target: { value: 'acc-exp' } })
  fireEvent.change(screen.getByLabelText('السبب *'), { target: { value: 'جرد فعلي' } })
}

async function addMappedProductWithQty() {
  searchAndOpenPicker('Widget')
  const productButton = await screen.findByText('Widget')
  fireEvent.click(productButton)
  fireEvent.click(screen.getByRole('button', { name: 'إضافة' }))
  // A quantity input appears for the added row; make the difference non-zero.
  const qtyInput = await screen.findByDisplayValue('0')
  fireEvent.change(qtyInput, { target: { value: '8' } })
}

describe('StockAdjustments — fail-closed UoM re-validation on save/post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTables()
    h.uomStatus.isEnabled = true
    h.uomStatus.isLoading = false
    h.uomStatus.isError = false
    h.uomStatus.isSuccess = true
    h.uomStatus.needsSetup = () => false
    h.validateAdjustmentProductUoms.mockResolvedValue([])
    h.itemsGetAll.mockResolvedValue([
      { id: 'p-1', name: 'Widget', name_ar: 'ودجت', code: 'C1', stock_quantity: 10, cost_price: 5 },
    ])
    h.getSupabase.mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
      from: vi.fn((table: string) => makeQuery(table)),
      rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
    })
  })

  it('shows a loading state in the picker instead of a selectable list', async () => {
    h.uomStatus.isLoading = true
    h.uomStatus.isSuccess = false
    await openNewForm()
    searchAndOpenPicker('Wid')
    expect(await screen.findByText('جارٍ التحقق من إعداد وحدات الأصناف…')).toBeInTheDocument()
  })

  it('shows an error state in the picker when the status projection failed', async () => {
    h.uomStatus.isError = true
    h.uomStatus.isSuccess = false
    await openNewForm()
    searchAndOpenPicker('Wid')
    expect(
      await screen.findByText('تعذّر التحقق من حالة وحدات الأصناف — لا يمكن اختيار صنف الآن'),
    ).toBeInTheDocument()
  })

  it('renders an unmapped product as a non-selectable row carrying the setup badge', async () => {
    h.uomStatus.needsSetup = () => true
    await openNewForm()
    searchAndOpenPicker('Widget')
    expect(await screen.findByText('يحتاج إعداد وحدة')).toBeInTheDocument()
    // The unmapped product name must not be a selectable button.
    const label = screen.getByText('Widget')
    expect(label.closest('button')).toBeNull()
  })

  it('blocks saving a draft when the fresh server read reports an unmapped product', async () => {
    h.validateAdjustmentProductUoms.mockResolvedValue(['p-1'])
    await openNewForm()
    await fillValidHeader()
    await addMappedProductWithQty()

    fireEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }))

    await waitFor(() => {
      expect(h.validateAdjustmentProductUoms).toHaveBeenCalledWith('org-1', ['p-1'])
    })
    expect(h.toast.error).toHaveBeenCalledWith(
      'لا يمكن الحفظ: توجد أصناف تحتاج إعداد وحدة قبل استخدامها في التسوية',
    )
    expect(h.toast.success).not.toHaveBeenCalled()
  })

  it('saves the draft when the fresh server read confirms every product is mapped', async () => {
    h.validateAdjustmentProductUoms.mockResolvedValue([])
    await openNewForm()
    await fillValidHeader()
    await addMappedProductWithQty()

    fireEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }))

    await waitFor(() => {
      expect(h.validateAdjustmentProductUoms).toHaveBeenCalledWith('org-1', ['p-1'])
    })
    await waitFor(() => {
      expect(h.toast.success).toHaveBeenCalled()
    })
  })

  it('blocks saving and surfaces an error when the fresh re-check itself fails', async () => {
    h.validateAdjustmentProductUoms.mockRejectedValue(new Error('read failed'))
    await openNewForm()
    await fillValidHeader()
    await addMappedProductWithQty()

    fireEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }))

    await waitFor(() => {
      expect(h.toast.error).toHaveBeenCalledWith('تعذّر التحقق من إعداد وحدات الأصناف — أعد المحاولة')
    })
    expect(h.toast.success).not.toHaveBeenCalled()
  })

  it('blocks posting a draft when the fresh server read reports an unmapped product', async () => {
    const draft = {
      id: 'adj-1',
      status: 'DRAFT',
      adjustment_type: 'PHYSICAL_COUNT',
      adjustment_number: 'ADJ-1',
      reference_number: 'REF-1',
      reason: 'جرد',
      adjustment_date: '2026-07-20',
      posting_date: '2026-07-20',
      warehouse_id: 'w1',
      increase_account_id: 'acc-asset',
      decrease_account_id: 'acc-exp',
    }
    tableResults.stock_adjustments = { list: { data: [draft], error: null }, single: { data: draft, error: null } }
    tableResults.stock_adjustment_items = {
      list: {
        data: [
          { id: 'i1', product_id: 'p-1', difference_qty: -2, new_qty: 8, current_rate: 5, value_difference: -10, warehouse_id: 'w1' },
        ],
        error: null,
      },
    }
    h.validateAdjustmentProductUoms.mockResolvedValue(['p-1'])
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderAdjustments()
    const row = await screen.findByLabelText('عرض تفاصيل تسوية المخزون adj-1')
    fireEvent.click(row)
    fireEvent.click(await screen.findByRole('button', { name: '✅ ترحيل' }))

    await waitFor(() => {
      expect(h.validateAdjustmentProductUoms).toHaveBeenCalledWith('org-1', ['p-1'])
    })
    expect(h.toast.error).toHaveBeenCalledWith('لا يمكن الترحيل: توجد أصناف تحتاج إعداد وحدة في هذه التسوية')
  })

  it('skips the re-check entirely when the UoM engine is disabled', async () => {
    h.uomStatus.isEnabled = false
    await openNewForm()
    await fillValidHeader()
    await addMappedProductWithQty()

    fireEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }))

    await waitFor(() => {
      expect(h.toast.success).toHaveBeenCalled()
    })
    expect(h.validateAdjustmentProductUoms).not.toHaveBeenCalled()
  })
})
