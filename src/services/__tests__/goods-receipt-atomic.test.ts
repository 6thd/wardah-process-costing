/**
 * اختبارات المسار الذرّي لاستلام البضاعة (Migration 89 — P5)
 * يتحقق من: RPC أولاً، Fail-closed عند فشل حقيقي (لا دفتر مخزون بلا مستند+قيد)،
 * وتمرير idempotency_key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockCreateSLE = vi.fn()
const mockGetBin = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  },
  resolveOrgIdWithFallback: vi.fn(() => Promise.resolve('org-gr-test')),
}))

vi.mock('@/services/stock-ledger-service', () => ({
  createStockLedgerEntry: (...a: unknown[]) => mockCreateSLE(...a),
  getBin: (...a: unknown[]) => mockGetBin(...a),
}))

import { receiveGoods } from '../purchasing-service'

const receipt = {
  purchase_order_id: 'po-1',
  vendor_id: 'vendor-1',
  receipt_date: '2026-07-10',
  warehouse_id: 'wh-1',
  warehouse_location: 'A1',
  receiver_name: 'Tester',
} as Parameters<typeof receiveGoods>[0]

const lines = [
  { product_id: 'prod-1', purchase_order_line_id: 'pol-1', ordered_quantity: 100,
    received_quantity: 100, unit_cost: 5, quality_status: 'accepted' },
] as Parameters<typeof receiveGoods>[1]

describe('receiveGoods — المسار الذرّي (Migration 89)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('يستدعي rpc_post_goods_receipt أولاً ويمرّر idempotency_key + vendor + lines', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, goods_receipt_id: 'gr-1', receipt_number: 'GR-000001' },
      error: null,
    })
    mockGetBin.mockResolvedValue({ data: null })
    mockCreateSLE.mockResolvedValue({ success: true })
    mockFrom.mockImplementation(() => {
      const c: Record<string, unknown> = {}
      c.select = vi.fn().mockReturnValue(c)
      c.eq = vi.fn().mockReturnValue(c)
      c.single = vi.fn().mockResolvedValue({ data: { received_quantity: 0, quantity: 100 } })
      c.update = vi.fn().mockReturnValue(c)
      c.upsert = vi.fn().mockResolvedValue({ error: null })
      return c
    })

    await receiveGoods(receipt, lines)

    // الأهم: الـ RPC الذرّي استُدعي أولاً بحمولة صحيحة (بغضّ النظر عن دفتر المخزون)
    expect(mockRpc).toHaveBeenCalledWith('rpc_post_goods_receipt', expect.anything())
    const payload = mockRpc.mock.calls[0][1].p_payload as {
      idempotency_key?: string; vendor_id?: string; lines?: unknown[]
    }
    expect(typeof payload.idempotency_key).toBe('string')
    expect(payload.vendor_id).toBe('vendor-1')
    expect(payload.lines).toHaveLength(1)
  })

  it('Fail-closed: خطأ حقيقي من الـ RPC (فشل GRNI) يوقف العملية — لا دفتر مخزون', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'EVENT_MAPPING_NOT_FOUND: GR_RECEIPT' },
    })

    const res = await receiveGoods(receipt, lines)

    expect(res.success).toBe(false)
    // لم يصل إلى دفتر المخزون إطلاقاً
    expect(mockCreateSLE).not.toHaveBeenCalled()
  })

  it('Fallback: غياب الدالة (PGRST202) يسقط للمسار القديم (إدراج يدوي)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    })
    mockGetBin.mockResolvedValue({ data: null })
    mockCreateSLE.mockResolvedValue({ success: true })
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'gr-legacy' }, error: null }) }),
    })
    mockFrom.mockImplementation(() => {
      const c: Record<string, unknown> = {}
      c.insert = insertSpy
      c.select = vi.fn().mockReturnValue(c)
      c.eq = vi.fn().mockReturnValue(c)
      c.single = vi.fn().mockResolvedValue({ data: { received_quantity: 0, quantity: 100 } })
      c.update = vi.fn().mockReturnValue(c)
      c.upsert = vi.fn().mockResolvedValue({ error: null })
      return c
    })

    await receiveGoods(receipt, lines)

    // المسار القديم أدرج الرأس يدوياً (fallback عند غياب الدالة الذرّية)
    expect(insertSpy).toHaveBeenCalled()
  })
})
