/**
 * اختبارات المسار الذرّي لاستلام البضاعة (Migration 89 — P5)
 * يتحقق من: RPC أولاً، Fail-closed عند فشل حقيقي (لا دفتر مخزون بلا مستند+قيد)،
 * وتمرير idempotency_key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  afterEach(() => vi.unstubAllEnvs())

  it('Fail-closed في الإنتاج: غياب الدالة (PGRST202) يرمي بدل المسار المتسامح', async () => {
    vi.stubEnv('PROD', true)
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    })
    const insertSpy = vi.fn()
    mockFrom.mockImplementation(() => ({ insert: insertSpy }))

    const res = await receiveGoods(receipt, lines)

    expect(res.success).toBe(false)
    // لم يلجأ للمسار القديم في الإنتاج
    expect(insertSpy).not.toHaveBeenCalled()
    expect(mockCreateSLE).not.toHaveBeenCalled()
  })

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
    // RPC نجح لكن بلا علم inventory_atomic (مهاجرة 89/90 قديمة) ⇒ الواجهة تُطبّق
    // دفتر المخزون لئلا يُسجَّل استلام بلا حركة مخزون
    expect(mockCreateSLE).toHaveBeenCalled()
  })

  it('المسار الذرّي: دفتر المخزون (SLE) يُطبَّق داخل الـ RPC — لا يُكرَّر في الواجهة (Migration 94)', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, goods_receipt_id: 'gr-2', receipt_number: 'GR-000002', inventory_atomic: true },
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

    const res = await receiveGoods(receipt, lines)

    expect(res.success).toBe(true)
    // دفتر المخزون انتقل للـ RPC (ذرّي) ⇒ الواجهة لا تُنشئ SLE في المسار الأساسي
    expect(mockCreateSLE).not.toHaveBeenCalled()
  })

  it('idempotent replay: لا يُكرّر دفتر المخزون في الواجهة (Migration 95 P0-1)', async () => {
    // إعادة إرسال بنفس المفتاح ⇒ الـ RPC يعيد idempotent_replay + inventory_atomic
    mockRpc.mockResolvedValue({
      data: { success: true, goods_receipt_id: 'gr-existing', receipt_number: 'GR-000007',
        idempotent_replay: true, inventory_atomic: true },
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

    const res = await receiveGoods(receipt, lines, 'stable-key-1')

    expect(res.success).toBe(true)
    // replay ⇒ الدفتر عولج أصلاً في الاستدعاء الأصلي ⇒ لا SLE مكرَّر
    expect(mockCreateSLE).not.toHaveBeenCalled()
    // مُرِّر المفتاح الثابت للـ RPC
    expect(mockRpc.mock.calls[0][1].p_payload.idempotency_key).toBe('stable-key-1')
  })

  it('Fail-closed: replay من دالة قديمة بلا inventory_atomic يُرفض (لا تخطٍّ صامت للدفتر)', async () => {
    // دالة 89/90 قديمة: replay بلا inventory_atomic ⇒ حالة الدفتر غير مؤكَّدة ⇒ رفض
    mockRpc.mockResolvedValue({
      data: { success: true, goods_receipt_id: 'gr-legacy-replay', receipt_number: 'GR-000008',
        idempotent_replay: true },
      error: null,
    })
    mockGetBin.mockResolvedValue({ data: null })
    mockCreateSLE.mockResolvedValue({ success: true })
    mockFrom.mockImplementation(() => ({ insert: vi.fn() }))

    const res = await receiveGoods(receipt, lines, 'stable-key-2')

    expect(res.success).toBe(false)
    // لم يُكرَّر دفتر المخزون ولا خُطّي عنه صامتاً
    expect(mockCreateSLE).not.toHaveBeenCalled()
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
    // وفي مسار الـ fallback (تطوير) يبقى دفتر المخزون في الواجهة
    expect(mockCreateSLE).toHaveBeenCalled()
  })

  // عقد Snapshot أمر الشراء (Migration 148): الخادم يرفض السطر المرتبط بأمر شراء
  // ذي معامل ≠ 1 إذا وصلته الكمية بوحدة الأساس فقط، لأنها ملتبسة مع وحدة الإدخال.
  // لذلك يجب أن تُمرَّر الحقول الصريحة كما وردت من المستدعي دون إسقاط.
  it('يمرّر عقد Snapshot — uom_id وqty_entered وunit_cost_entered — إلى الـRPC', async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        goods_receipt_id: 'gr-2',
        receipt_number: 'GR-000002',
        inventory_atomic: true,
      },
      error: null,
    })
    mockFrom.mockImplementation(() => {
      const c: Record<string, unknown> = {}
      c.select = vi.fn().mockReturnValue(c)
      c.eq = vi.fn().mockReturnValue(c)
      c.single = vi.fn().mockResolvedValue({ data: { received_quantity: 0, quantity: 120 } })
      c.update = vi.fn().mockReturnValue(c)
      c.upsert = vi.fn().mockResolvedValue({ error: null })
      return c
    })

    const snapshotLines = [
      {
        product_id: 'prod-1',
        purchase_order_line_id: 'pol-1',
        ordered_quantity: 120,
        received_quantity: 48,
        unit_cost: 10,
        quality_status: 'rejected',
        uom_id: 'uom-carton',
        qty_entered: 4,
        unit_cost_entered: 120,
      },
    ] as Parameters<typeof receiveGoods>[1]

    await receiveGoods(receipt, snapshotLines)

    const payload = mockRpc.mock.calls[0][1].p_payload as {
      lines: Array<Record<string, unknown>>
    }
    expect(payload.lines[0]).toMatchObject({
      purchase_order_line_id: 'pol-1',
      uom_id: 'uom-carton',
      qty_entered: 4,
      unit_cost_entered: 120,
      // حالة الجودة تُنقل كما اختارها المستخدم ولا تُثبَّت على "مقبول".
      quality_status: 'rejected',
    })
  })

  it('يرسل null بدل حذف حقول Snapshot عندما لا يوفّرها المستدعي', async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        goods_receipt_id: 'gr-3',
        receipt_number: 'GR-000003',
        inventory_atomic: true,
      },
      error: null,
    })
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

    const payload = mockRpc.mock.calls[0][1].p_payload as {
      lines: Array<Record<string, unknown>>
    }
    expect(payload.lines[0]).toMatchObject({
      uom_id: null,
      qty_entered: null,
      unit_cost_entered: null,
    })
  })
})
