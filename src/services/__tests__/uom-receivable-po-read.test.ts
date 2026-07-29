/**
 * قراءة أوامر الشراء القابلة للاستلام (Migration 148).
 *
 * الحدّ الخارجي الوحيد المعزول هو عميل Supabase؛ التطبيع والتحقق من العقد يعملان
 * فعليًا. الأهمية أن هذه الدالة هي المصدر الوحيد لبيانات Snapshot التي تُبنى منها
 * حمولة الاستلام: أي حقل مفقود أو معامل غير موجب يجب أن يفشل هنا fail-closed بدل
 * أن يتسرب إلى الخادم كمية أساس خاطئة.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mocks.rpc(...args) },
}))

import { listUomReceivablePurchaseOrders } from '@/services/uom-goods-receipt-service'

const line = (over: Record<string, unknown> = {}) => ({
  id: 'pol-1',
  line_number: 1,
  product_id: 'prod-1',
  product: { code: 'RM-1', name: 'PP Sheet', name_ar: 'صفائح' },
  uom_id: 'uom-ton',
  uom: {
    id: 'uom-ton', code: 'TON', name: 'Metric ton',
    name_ar: 'طن', symbol: 'طن', decimal_places: 3,
  },
  conversion_factor_snapshot: 1000,
  ordered_qty_entered: 0.5,
  ordered_qty_base: 500,
  received_qty_entered: 0,
  received_qty_base: 0,
  accepted_qty_base: 0,
  rejected_qty_base: 0,
  pending_qty_base: 0,
  remaining_qty_entered: 0.5,
  remaining_qty_base: 500,
  unit_cost_entered: 2000,
  unit_cost_base: 2,
  ...over,
})

const order = (over: Record<string, unknown> = {}) => ({
  id: 'po-1',
  order_number: 'PO-1',
  vendor_id: 'vendor-1',
  vendor: { id: 'vendor-1', code: 'V1', name: 'مورد' },
  order_date: '2026-07-24',
  expected_delivery_date: null,
  status: 'approved',
  total_amount: 1150,
  lines: [line()],
  ...over,
})

const resolve = (data: unknown) => mocks.rpc.mockResolvedValue({ data, error: null })

describe('listUomReceivablePurchaseOrders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('تمرّر المؤسسة المختارة صراحة إلى الـRPC المحروسة', async () => {
    resolve([order()])
    await listUomReceivablePurchaseOrders('org-7')

    expect(mocks.rpc).toHaveBeenCalledWith('rpc_list_uom_receivable_purchase_orders', {
      p_org_id: 'org-7',
    })
  })

  it('غياب المؤسسة يفشل قبل أي نداء شبكي', async () => {
    await expect(listUomReceivablePurchaseOrders('')).rejects.toThrow('ORG_ID_REQUIRED')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('تطبّع الأمر والسطر مع الحفاظ على قيم Snapshot', async () => {
    resolve([order()])
    const [result] = await listUomReceivablePurchaseOrders('org-1')

    expect(result).toMatchObject({
      id: 'po-1',
      order_number: 'PO-1',
      vendor_id: 'vendor-1',
      status: 'approved',
      total_amount: 1150,
    })
    expect(result.lines[0]).toMatchObject({
      id: 'pol-1',
      uom_id: 'uom-ton',
      conversion_factor_snapshot: 1000,
      ordered_qty_entered: 0.5,
      remaining_qty_entered: 0.5,
      unit_cost_entered: 2000,
      unit_cost_base: 2,
    })
  })

  it('قائمة فارغة تعود فارغة بلا خطأ', async () => {
    resolve([])
    await expect(listUomReceivablePurchaseOrders('org-1')).resolves.toEqual([])
  })

  it('خطأ الخادم يُمرَّر كما هو ولا يُبتلع', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('UOM_ENGINE_NOT_ENABLED_FOR_ORG'),
    })
    await expect(listUomReceivablePurchaseOrders('org-1'))
      .rejects.toThrow('UOM_ENGINE_NOT_ENABLED_FOR_ORG')
  })

  it.each<[unknown, string]>([
    [null, 'null'],
    [{ orders: [] }, 'كائن بدل مصفوفة'],
    ['[]', 'نص'],
  ])('استجابة غير مصفوفة (%s) تفشل بعقد صريح', async (data) => {
    resolve(data)
    await expect(listUomReceivablePurchaseOrders('org-1'))
      .rejects.toThrow('RECEIVABLE_PO_RESPONSE_INVALID')
  })

  // fail-closed: بناء حمولة استلام من سطر ناقص Snapshot يكتب كمية أساس خاطئة بصمت.
  it.each<[Record<string, unknown>, string]>([
    [{ id: undefined }, 'بلا معرّف'],
    [{ product_id: undefined }, 'بلا منتج'],
    [{ uom_id: undefined }, 'بلا وحدة'],
    [{ conversion_factor_snapshot: 0 }, 'معامل صفر'],
    [{ conversion_factor_snapshot: -1 }, 'معامل سالب'],
    [{ conversion_factor_snapshot: 'abc' }, 'معامل غير رقمي'],
  ])('سطر %s يفشل بـRECEIVABLE_PO_LINE_CONTRACT_INVALID', async (broken) => {
    resolve([order({ lines: [line(broken)] })])
    await expect(listUomReceivablePurchaseOrders('org-1'))
      .rejects.toThrow('RECEIVABLE_PO_LINE_CONTRACT_INVALID')
  })

  // الخادم يرشّح الحالات، لكن العميل لا يثق: أمر غير قابل للاستلام يصل من نسخة
  // خادم قديمة يجب أن يُرفض بدل عرضه للاستلام ثم فشله بـPO_NOT_RECEIVABLE.
  it.each([['draft'], ['submitted'], ['fully_received'], ['cancelled']])(
    'أمر بحالة %s يُرفض بـRECEIVABLE_PO_CONTRACT_INVALID',
    async (status) => {
      resolve([order({ status })])
      await expect(listUomReceivablePurchaseOrders('org-1'))
        .rejects.toThrow('RECEIVABLE_PO_CONTRACT_INVALID')
    }
  )

  it('partially_received حالة قانونية للاستلام', async () => {
    resolve([order({ status: 'partially_received' })])
    const [result] = await listUomReceivablePurchaseOrders('org-1')
    expect(result.status).toBe('partially_received')
  })

  it('أمر بلا مصفوفة سطور يعود بسطور فارغة بدل الانهيار', async () => {
    resolve([order({ lines: null })])
    const [result] = await listUomReceivablePurchaseOrders('org-1')
    expect(result.lines).toEqual([])
  })

  it('القيم الرقمية النصية تُحوَّل، والحقول الاختيارية الغائبة تصبح null', async () => {
    resolve([order({
      total_amount: '1150.50',
      expected_delivery_date: undefined,
      lines: [line({ product: { code: 'RM-1' }, unit_cost_entered: '2000' })],
    })])
    const [result] = await listUomReceivablePurchaseOrders('org-1')

    expect(result.total_amount).toBe(1150.5)
    expect(result.expected_delivery_date).toBeNull()
    expect(result.lines[0].product.name).toBeNull()
    expect(result.lines[0].product.name_ar).toBeNull()
    expect(result.lines[0].unit_cost_entered).toBe(2000)
  })
})
