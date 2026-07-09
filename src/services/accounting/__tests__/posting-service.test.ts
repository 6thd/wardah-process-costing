/**
 * اختبارات PostingService — بوابة أحداث GL (P4-B6)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-ptest')),
}))

import { PostingService } from '../posting-service'

describe('PostingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('postEventJournal يستدعي rpc_post_event_journal بالمعاملات الصحيحة', async () => {
    mockRpc.mockResolvedValue({ data: 'entry-uuid-1', error: null })

    const id = await PostingService.postEventJournal({
      event: 'GR_RECEIPT',
      amount: 1500,
      memo: 'استلام بضاعة GR-001',
      refType: 'GOODS_RECEIPT',
      refId: 'gr-1',
      idempotencyKey: 'GR_RECEIPT:gr-1',
    })

    expect(id).toBe('entry-uuid-1')
    expect(mockRpc).toHaveBeenCalledWith('rpc_post_event_journal', expect.objectContaining({
      p_event: 'GR_RECEIPT',
      p_amount: 1500,
      p_ref_type: 'GOODS_RECEIPT',
      p_idempotency_key: 'GR_RECEIPT:gr-1',
    }))
  })

  it('postEventJournal يرمي رسالة الخطأ من القاعدة كما هي', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'NO_MAPPING: لا خريطة للحدث GR_RECEIPT' },
    })

    await expect(
      PostingService.postEventJournal({
        event: 'GR_RECEIPT',
        amount: 100,
        memo: 'x',
        refType: 'GOODS_RECEIPT',
      })
    ).rejects.toThrow('NO_MAPPING')
  })

  it('postWorkCenterOH يستدعي rpc_post_work_center_oh', async () => {
    mockRpc.mockResolvedValue({ data: 'entry-uuid-2', error: null })

    const id = await PostingService.postWorkCenterOH({
      workCenter: 'MIXING',
      amount: 800,
      memo: 'أوفرهيد الخلط',
      refType: 'MO_STAGE',
    })

    expect(id).toBe('entry-uuid-2')
    expect(mockRpc).toHaveBeenCalledWith('rpc_post_work_center_oh', expect.objectContaining({
      p_work_center: 'MIXING',
      p_amount: 800,
    }))
  })
})
