/**
 * اختبارات JournalService — مسار المال الأهم (P4-B6)
 * Migration 178: manual-journal RPC boundary | التوازن | تمرير الأخطاء
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

  it('يستخدم rpc_create_manual_journal_entry المحروس عند إنشاء قيد يدوي', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, entry_id: 'e-1', entry_number: 'JE-0001', status: 'draft' },
      error: null,
    })

    const result = await JournalService.createEntry(balancedRequest)

    expect(result.success).toBe(true)
    expect(result.data.id).toBe('e-1')
    expect(mockRpc).toHaveBeenCalledWith('rpc_create_manual_journal_entry', {
      p_payload: expect.objectContaining({
        org_id: 'org-jtest',
        entry_date: '2026-07-01',
        lines: expect.arrayContaining([
          expect.objectContaining({ account_id: 'acc-1', debit: 500 }),
        ]),
      }),
    })
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

  it('يمرر خطأ RPC الحقيقي بلا fallback أو تغليف إضافي', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'PERIOD_CLOSED: الفترة 2026-06 مقفلة' },
    })

    const result = await JournalService.createEntry(balancedRequest)

    expect(result.success).toBe(false)
    expect(result.error).toBe('PERIOD_CLOSED: الفترة 2026-06 مقفلة')
    expect(mockRpc).toHaveBeenCalledWith('rpc_create_manual_journal_entry', expect.any(Object))
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('يفشل مغلقًا إذا لم يرجع RPC معرّف قيد ناجحًا', async () => {
    mockRpc.mockResolvedValue({
      data: { success: false },
      error: null,
    })

    const result = await JournalService.createEntry(balancedRequest)

    expect(result).toEqual({ success: false, error: 'Manual journal RPC returned no entry' })
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

describe('JournalService canonical lifecycle RPCs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('يرحّل قيدًا واحدًا عبر صلاحية post المحروسة', async () => {
    mockRpc.mockResolvedValue({ data: { success: true }, error: null })

    const result = await JournalService.postJournalEntry('entry-post-1')

    expect(mockRpc).toHaveBeenCalledWith('rpc_post_manual_journal_entry', {
      p_entry_id: 'entry-post-1',
    })
    expect(result).toEqual({ success: true, message: 'Entry posted successfully' })
  })

  it('يفشل ترحيل القيد مغلقًا عند رفض RPC أو عند نتيجة غير ناجحة', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'PERMISSION_DENIED' } })
      .mockResolvedValueOnce({ data: { success: false }, error: null })

    await expect(JournalService.postJournalEntry('entry-post-denied')).resolves.toEqual({
      success: false,
      error: 'PERMISSION_DENIED',
    })
    await expect(JournalService.postJournalEntry('entry-post-failed')).resolves.toEqual({
      success: false,
      error: 'Failed to post entry',
    })
  })

  it('يرحّل الدفعة عبر rpc_batch_post_manual_journal_entries فقط', async () => {
    const rpcResult = {
      success: true,
      total: 2,
      success_count: 2,
      fail_count: 0,
      results: [
        { entry_id: 'e-1', success: true },
        { entry_id: 'e-2', success: true },
      ],
    }
    mockRpc.mockResolvedValue({ data: rpcResult, error: null })

    const result = await JournalService.batchPostEntries(['e-1', 'e-2'])

    expect(mockRpc).toHaveBeenCalledWith('rpc_batch_post_manual_journal_entries', {
      p_entry_ids: ['e-1', 'e-2'],
    })
    expect(result).toEqual(rpcResult)
  })

  it('ينقل خطأ دفعة الترحيل ولا يحاول مسارًا قديمًا', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'PERMISSION_DENIED' } })

    await expect(JournalService.batchPostEntries(['e-1'])).rejects.toThrow('PERMISSION_DENIED')
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('يبقي فحص الموافقة القديم للقراءة فقط ويفشل مغلقًا عند خطئه', async () => {
    const approvalState = { required: true, required_levels: 2, current_levels: 1 }
    mockRpc
      .mockResolvedValueOnce({ data: approvalState, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'LEGACY_READ_FAILED' } })

    await expect(JournalService.checkApprovalRequired('e-approve')).resolves.toEqual(approvalState)
    await expect(JournalService.checkApprovalRequired('e-approve')).resolves.toEqual({
      required: false,
      required_levels: 0,
      current_levels: 0,
    })
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'check_entry_approval_required', {
      p_entry_id: 'e-approve',
    })
  })

  it('يعطّل mutation الموافقة القديم صراحة إلى أن يكتمل #175', async () => {
    await expect(JournalService.approveEntry('e-approve', 1, 'ok')).rejects.toThrow(
      'Legacy journal approval is disabled pending the canonical gl_entries workflow (#175)',
    )
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('يعكس القيد عبر reverse المحروس ويعالج replay idempotent', async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: {
          success: true,
          original_entry_id: 'e-original',
          reversal_entry_id: 'e-reversal',
          reversal_number: 'REV-1',
          duplicate: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          original_entry_id: 'e-original',
          reversal_entry_id: 'e-reversal',
          reversal_number: 'REV-1',
          duplicate: true,
        },
        error: null,
      })

    const first = await JournalService.reverseEntry('e-original', 'تصحيح', '2026-08-24')
    const replay = await JournalService.reverseEntry('e-original', 'تصحيح', '2026-08-24')

    expect(mockRpc).toHaveBeenNthCalledWith(1, 'rpc_reverse_manual_journal_entry', {
      p_entry_id: 'e-original',
      p_reversal_reason: 'تصحيح',
      p_reversal_date: '2026-08-24',
    })
    expect(first.message).toBe('Entry reversed successfully')
    expect(replay.message).toBe('Entry already reversed')
  })

  it('ينقل خطأ reverse المحروس بلا fallback إلى دالة legacy', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'PERMISSION_DENIED' } })

    await expect(
      JournalService.reverseEntry('e-original', 'تصحيح', '2026-08-24'),
    ).rejects.toThrow('PERMISSION_DENIED')
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
