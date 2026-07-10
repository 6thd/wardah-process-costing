/**
 * اختبارات JournalService — مسار المال الأهم (P4-B6)
 * RPC الذرّي أولاً | Fallback عند PGRST202 | التوازن | تمرير الأخطاء
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-jtest')),
}))

import { JournalService } from '../journal-service'

const balancedRequest = {
  entry_date: '2026-07-01',
  description: 'قيد اختبار',
  lines: [
    { account_id: 'acc-1', line_number: 1, debit: 500, credit: 0 },
    { account_id: 'acc-2', line_number: 2, debit: 0, credit: 500 },
  ],
}

describe('JournalService.createEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('يستخدم rpc_create_journal_entry الذرّي عند توفره', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, entry_id: 'e-1', entry_number: 'JE-0001', status: 'draft' },
      error: null,
    })

    const result = await JournalService.createEntry(balancedRequest)

    expect(result.success).toBe(true)
    expect(result.data.id).toBe('e-1')
    expect(mockRpc).toHaveBeenCalledWith('rpc_create_journal_entry', {
      p_payload: expect.objectContaining({
        org_id: 'org-jtest',
        entry_date: '2026-07-01',
        lines: expect.arrayContaining([
          expect.objectContaining({ account_id: 'acc-1', debit: 500 }),
        ]),
      }),
    })
    // المسار الذرّي لا يلمس الجداول مباشرة
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('يرفض القيد غير المتوازن قبل أي نداء للقاعدة', async () => {
    const unbalanced = {
      ...balancedRequest,
      lines: [
        { account_id: 'acc-1', line_number: 1, debit: 500, credit: 0 },
        { account_id: 'acc-2', line_number: 2, debit: 0, credit: 300 },
      ],
    }

    const result = await JournalService.createEntry(unbalanced)

    expect(result.success).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('خطأ حقيقي من الدالة الذرّية (فترة مقفلة) يصل كما هو — لا fallback', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'PERIOD_CLOSED: الفترة 2026-06 مقفلة' },
    })

    const result = await JournalService.createEntry(balancedRequest)

    expect(result.success).toBe(false)
    expect(String(result.error?.message ?? result.error)).toContain('PERIOD_CLOSED')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('يقبل فرق تقريب ضمن هامش 0.01', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, entry_id: 'e-3', entry_number: 'JE-0003', status: 'draft' },
      error: null,
    })

    const nearlyBalanced = {
      ...balancedRequest,
      lines: [
        { account_id: 'acc-1', line_number: 1, debit: 100.005, credit: 0 },
        { account_id: 'acc-2', line_number: 2, debit: 0, credit: 100 },
      ],
    }

    const result = await JournalService.createEntry(nearlyBalanced)
    expect(result.success).toBe(true)
  })
})
