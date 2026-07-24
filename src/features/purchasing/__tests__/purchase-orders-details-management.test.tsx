import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  getAllNew: vi.fn(),
  getAllLegacy: vi.fn(),
  single: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/services/supabase-service', () => ({
  newPurchaseOrdersService: { getAll: mocks.getAllNew },
  purchaseOrdersService: { getAll: mocks.getAllLegacy },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: mocks.single })),
      })),
    })),
  },
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError },
}))

vi.mock('@/components/forms/PurchaseOrderForm', () => ({
  PurchaseOrderForm: ({ open, onOpenChange, onSuccess }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: () => void
  }) => open ? (
    <div>
      <span>نموذج أمر الشراء</span>
      <button type="button" onClick={() => onOpenChange(false)}>إغلاق النموذج</button>
      <button type="button" onClick={onSuccess}>نجاح الحفظ</button>
    </div>
  ) : null,
}))

vi.mock('../index', () => ({
  PurchasingModule: () => <div>الوحدة الأصلية</div>,
}))

import {
  PurchaseOrdersDetailsManagement,
  PurchasingModuleHotfix,
} from '../PurchasingModuleHotfix'

const listOrder = {
  id: 'po-1',
  order_number: 'PO-20260724-07B821D3',
  order_date: '2026-07-24',
  expected_delivery_date: '2026-07-30',
  status: 'draft',
  tax_amount: 150,
  total_amount: 1150,
  vendor: { name: 'شركة المواد الخام المحدودة' },
  purchase_order_lines: [
    {
      id: 'line-1',
      qty_entered: 0.5,
      quantity: 500,
      product: { name: 'PP Clear Sheet' },
    },
  ],
}

const fullOrder = {
  ...listOrder,
  subtotal: 1000,
  discount_amount: 0,
  purchase_order_lines: [
    {
      id: 'line-1',
      line_number: 1,
      qty_entered: 0.5,
      quantity: 500,
      conversion_factor_snapshot: 1000,
      unit_price_entered: 2000,
      unit_price: 2,
      discount_percentage: 0,
      tax_percentage: 15,
      line_total: 1150,
      product: { code: 'RM-010', name: 'PP Clear Sheet' },
      uom: { code: 'TON', name_ar: 'طن' },
    },
  ],
}

describe('PurchaseOrdersDetailsManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllNew.mockResolvedValue([listOrder])
    mocks.getAllLegacy.mockResolvedValue([])
    mocks.single.mockResolvedValue({ data: fullOrder, error: null })
  })

  it('opens an order from an accessible card and shows UoM snapshots', async () => {
    const user = userEvent.setup()
    render(<PurchaseOrdersDetailsManagement />)

    const card = await screen.findByRole('button', {
      name: 'عرض تفاصيل أمر الشراء PO-20260724-07B821D3',
    })
    expect(card).toBeInTheDocument()
    expect(screen.getByText('PP Clear Sheet (0.5)')).toBeInTheDocument()
    expect(screen.getByText('شامل ضريبة: 150.00 ريال')).toBeInTheDocument()

    await user.click(card)

    expect(await screen.findByText('0.5 طن')).toBeInTheDocument()
    expect(screen.getByText('500 كجم')).toBeInTheDocument()
    expect(screen.getByText('2,000.00')).toBeInTheDocument()
    expect(mocks.single).toHaveBeenCalledTimes(1)
  })

  it('opens and closes the create form, then reloads after success', async () => {
    const user = userEvent.setup()
    render(<PurchaseOrdersDetailsManagement />)

    await screen.findByText('PO-20260724-07B821D3')
    await user.click(screen.getByRole('button', { name: '+ إضافة أمر شراء' }))
    expect(screen.getByText('نموذج أمر الشراء')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'نجاح الحفظ' }))
    await waitFor(() => expect(mocks.getAllNew).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: 'إغلاق النموذج' }))
    expect(screen.queryByText('نموذج أمر الشراء')).not.toBeInTheDocument()
  })

  it('falls back to the legacy reader and renders an empty state', async () => {
    mocks.getAllNew.mockRejectedValue(new Error('new reader unavailable'))
    mocks.getAllLegacy.mockResolvedValue([])

    render(<PurchaseOrdersDetailsManagement />)

    expect(await screen.findByText('لا توجد أوامر شراء مسجلة.')).toBeInTheDocument()
    expect(mocks.getAllLegacy).toHaveBeenCalledTimes(1)
  })

  it('reports list and details failures without crashing', async () => {
    mocks.getAllNew.mockRejectedValueOnce(new Error('new reader unavailable'))
    mocks.getAllLegacy.mockRejectedValueOnce(new Error('legacy reader unavailable'))

    const { unmount } = render(<PurchaseOrdersDetailsManagement />)
    expect(await screen.findByText('لا توجد أوامر شراء مسجلة.')).toBeInTheDocument()
    expect(mocks.toastError).toHaveBeenCalledWith('خطأ في تحميل أوامر الشراء')
    unmount()

    mocks.getAllNew.mockResolvedValue([listOrder])
    mocks.single.mockResolvedValue({ data: null, error: new Error('details unavailable') })
    const user = userEvent.setup()
    render(<PurchaseOrdersDetailsManagement />)

    await user.click(await screen.findByRole('button', {
      name: 'عرض تفاصيل أمر الشراء PO-20260724-07B821D3',
    }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('تعذر تحميل تفاصيل أمر الشراء')
    })
  })
})

describe('PurchasingModuleHotfix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllNew.mockResolvedValue([])
  })

  it('uses the details view for the orders route including a trailing slash', async () => {
    render(
      <MemoryRouter initialEntries={['/purchasing/orders/']}>
        <PurchasingModuleHotfix />
      </MemoryRouter>,
    )

    expect(await screen.findByText('لا توجد أوامر شراء مسجلة.')).toBeInTheDocument()
  })

  it('delegates other purchasing routes to the original module', () => {
    render(
      <MemoryRouter initialEntries={['/purchasing/receipts']}>
        <PurchasingModuleHotfix />
      </MemoryRouter>,
    )

    expect(screen.getByText('الوحدة الأصلية')).toBeInTheDocument()
  })
})
