/**
 * عقد نموذج الاستلام التقليدي مقابل الخادم (Migration 148).
 *
 * هذا الاختبار **لا يستبدل النموذج بـmock**؛ يشغّل استعلامه الفعلي ومنطقه، لأن
 * العطل الذي يحرسه لا يظهر إلا هناك: النموذج كان يستعلم عن
 * `['confirmed','partially_received','draft']` بينما الخادم بعد 148 لا يقبل إلا
 * `approved` و`partially_received`. النتيجة كانت أن الأمر المعتمد — وهو الوحيد
 * القانوني لأول استلام — لا يظهر أصلًا، بينما تظهر أوامر تفشل حتمًا عند الإرسال.
 *
 * اختبار بوابة الطرح المجاور يثبت **أي** نموذج يُفتح؛ هذا يثبت أن النموذج
 * المفتوح يعمل فعلًا.
 */
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// jsdom لا يوفّر Pointer Capture ولا scrollIntoView، وRadix Select يعتمدهما لتثبيت
// القيمة المختارة. تُضاف محليًا لهذا الملف بدل تعديل الإعداد العام للاختبارات.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

const mocks = vi.hoisted(() => ({
  receiveGoods: vi.fn(),
  orderQuery: { in: vi.fn(), order: vi.fn() },
  capturedStatuses: [] as string[],
  orders: [] as Array<Record<string, unknown>>,
  lines: [] as Array<Record<string, unknown>>,
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/services/purchasing-service', () => ({
  receiveGoods: mocks.receiveGoods,
}))

vi.mock('@/components/ui/warehouse-selector', () => ({
  WarehouseSelector: ({ value, onChange }: {
    value: string
    onChange: (next: string) => void
  }) => (
    <button type="button" onClick={() => onChange('wh-1')}>
      {value ? `مخزن:${value}` : 'اختر المخزن'}
    </button>
  ),
}))

vi.mock('@/components/ui/stock-balance-badge', () => ({
  StockBalanceInline: () => null,
}))

// عميل Supabase مصغّر يلتقط الحالات المطلوبة فعليًا ويردّ ما يطابقها فقط،
// تمامًا كما يفعل الخادم مع `.in('status', …)`.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'purchase_orders') {
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.in = (_column: string, statuses: string[]) => {
          mocks.capturedStatuses = statuses
          return builder
        }
        builder.order = () => Promise.resolve({
          data: mocks.orders.filter((order) =>
            mocks.capturedStatuses.includes(String(order.status))
          ),
          error: null,
        })
        return builder
      }

      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.order = () => Promise.resolve({ data: mocks.lines, error: null })
      return builder
    },
  },
}))

import { GoodsReceiptForm } from '../GoodsReceiptForm'

const order = (over: Record<string, unknown>) => ({
  id: 'po-approved',
  order_number: 'PO-APPROVED-1',
  status: 'approved',
  vendor_id: 'vendor-1',
  order_date: '2026-07-24',
  total_amount: 1150,
  vendor: { code: 'V1', name: 'مورد الاختبار' },
  ...over,
})

// 0.5 طن بمعامل 1000 ⇒ 500 كجم أساس، و2000 ريال/طن ⇒ 2 ريال/كجم.
const poLine = {
  id: 'pol-1',
  line_number: 1,
  product_id: 'prod-1',
  quantity: 500,
  received_quantity: 0,
  accepted_quantity: 0,
  rejected_quantity: 0,
  unit_price: 2,
  unit_price_entered: 2000,
  qty_entered: 0.5,
  conversion_factor_snapshot: 1000,
  uom_id: 'uom-ton',
  product: { code: 'RM-1', name: 'مادة خام' },
  uom: { id: 'uom-ton', symbol: 'طن', code: 'TON' },
}

const renderForm = () =>
  render(<GoodsReceiptForm open onOpenChange={vi.fn()} onSuccess={vi.fn()} />)

describe('نموذج الاستلام التقليدي — مطابقة عقد الخادم', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.capturedStatuses = []
    mocks.lines = [poLine]
    mocks.orders = [
      order({}),
      order({ id: 'po-draft', order_number: 'PO-DRAFT-1', status: 'draft' }),
      order({ id: 'po-submitted', order_number: 'PO-SUBMITTED-1', status: 'submitted' }),
      order({ id: 'po-confirmed', order_number: 'PO-CONFIRMED-1', status: 'confirmed' }),
      order({ id: 'po-partial', order_number: 'PO-PARTIAL-1', status: 'partially_received' }),
    ]
    mocks.receiveGoods.mockResolvedValue({
      success: true,
      data: { id: 'gr-1', receipt_number: 'GR-000001' },
    })
  })

  it('يطلب من الخادم الحالات القابلة للاستلام فقط', async () => {
    renderForm()
    await waitFor(() => expect(mocks.capturedStatuses.length).toBeGreaterThan(0))

    expect([...mocks.capturedStatuses].sort()).toEqual(['approved', 'partially_received'])
    expect(mocks.capturedStatuses).not.toContain('draft')
    expect(mocks.capturedStatuses).not.toContain('submitted')
    expect(mocks.capturedStatuses).not.toContain('confirmed')
  })

  it('الأمر المعتمد يظهر للاختيار، وdraft وsubmitted وconfirmed لا تظهر', async () => {
    renderForm()
    await waitFor(() => expect(mocks.capturedStatuses.length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('combobox', { name: /أمر الشراء/ }))

    expect(await screen.findByRole('option', { name: /PO-APPROVED-1/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /PO-PARTIAL-1/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /PO-DRAFT-1/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /PO-SUBMITTED-1/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /PO-CONFIRMED-1/ })).not.toBeInTheDocument()
  })

  it('استلام أمر معتمد يصل إلى receiveGoods بعقد Snapshot بوحدة الإدخال', async () => {
    renderForm()
    await waitFor(() => expect(mocks.capturedStatuses.length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('combobox', { name: /أمر الشراء/ }))
    await userEvent.click(await screen.findByRole('option', { name: /PO-APPROVED-1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'اختر المخزن' }))
    await userEvent.click(screen.getByRole('button', { name: 'تأكيد الاستلام' }))

    await waitFor(() => {
      if (mocks.toastError.mock.calls.length > 0) {
        throw new Error(`رفض التحقق: ${mocks.toastError.mock.calls[0][0]}`)
      }
      expect(mocks.receiveGoods).toHaveBeenCalled()
    })

    const [receipt, lines, idempotencyKey] = mocks.receiveGoods.mock.calls[0]
    expect(receipt).toMatchObject({ purchase_order_id: 'po-approved', warehouse_id: 'wh-1' })
    expect(typeof idempotencyKey).toBe('string')
    expect(lines[0]).toMatchObject({
      purchase_order_line_id: 'pol-1',
      uom_id: 'uom-ton',
      // الكمية بوحدة الإدخال (0.5 طن) لا بوحدة الأساس (500 كجم): إرسال الأساس
      // يجعل الخادم يضربها في المعامل مرة ثانية.
      qty_entered: 0.5,
      unit_cost_entered: 2000,
      quality_status: 'accepted',
    })
  })

  it('لا أوامر قابلة للاستلام: رسالة صريحة بلا استدعاء استلام', async () => {
    mocks.orders = [order({ id: 'po-draft', status: 'draft' })]
    renderForm()

    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalled())
    expect(mocks.receiveGoods).not.toHaveBeenCalled()
  })
})
