/**
 * اختبارات المسار الذرّي لإذن التسليم (Migration 85 — P4-B5)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-dn-test')),
}))

import { createDeliveryNote } from '../enhanced-sales-service'

/** سلسلة قراءة كاملة تُرجع نتيجة ثابتة */
function readChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

const deliveryInput = {
  sales_invoice_id: 'inv-1',
  customer_id: 'cust-1',
  delivery_date: '2026-07-09',
  lines: [
    {
      sales_invoice_line_id: 'invl-1',
      item_id: 'item-1',
      invoiced_quantity: 10,
      delivered_quantity: 10,
      unit_price: 50,
      unit_cost_at_delivery: 0,
      cogs_amount: 0
    }
  ]
} as Parameters<typeof createDeliveryNote>[0]

describe('createDeliveryNote — المسار الذرّي (Migration 85)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // فحص وجود الفاتورة + جلب التسليم الكامل بعد النجاح
    mockFrom.mockImplementation(() =>
      readChain({ data: { id: 'dn-atomic-1', delivery_number: 'DN-000009' }, error: null })
    )
  })

  it('يستخدم rpc_post_delivery_note عند توفرها ولا يلمس المسار القديم', async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        delivery_id: 'dn-atomic-1',
        delivery_number: 'DN-000009',
        total_cogs: 350,
        lines_processed: 1,
        warnings: []
      },
      error: null
    })

    const result = await createDeliveryNote(deliveryInput)

    expect(result.success).toBe(true)
    expect(result.totalCOGS).toBe(350)
    expect(mockRpc).toHaveBeenCalledWith('rpc_post_delivery_note', {
      p_payload: expect.objectContaining({
        sales_invoice_id: 'inv-1',
        lines: [expect.objectContaining({ item_id: 'item-1', delivered_quantity: 10 })]
      })
    })
  })

  it('خطأ حقيقي (رصيد غير كافٍ) يصل للمستخدم — لا fallback صامت', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'INSUFFICIENT_STOCK: صنف أ — المتاح: 3، المطلوب: 10' }
    })

    const result = await createDeliveryNote(deliveryInput)

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('INSUFFICIENT_STOCK')
  })

  it('تحذيرات الدالة الذرّية (COGS غير مزروع) تتصاعد للواجهة', async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        delivery_id: 'dn-atomic-2',
        delivery_number: 'DN-000010',
        total_cogs: 100,
        lines_processed: 1,
        warnings: ['قيد COGS لم يُرحَّل: NO_MAPPING — ازرع خريطة COGS_DELIVERY']
      },
      error: null
    })

    const result = await createDeliveryNote(deliveryInput)

    expect(result.success).toBe(true)
    expect(result.warnings?.[0]).toContain('COGS')
  })
})
