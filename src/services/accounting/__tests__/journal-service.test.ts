/**
 * JournalService tests — canonical gl_entries lifecycle.
 * Migration 180 retires the legacy journal approval surface; these tests lock
 * the active service to canonical create/post/reverse plus attachments/comments.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockStorageFrom = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    storage: {
      from: (...args: unknown[]) => mockStorageFrom(...args),
    },
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

  it('uses the canonical manual-journal RPC', async () => {
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

  it('rejects an unbalanced entry before touching the database', async () => {
    const result = await JournalService.createEntry({
      ...balancedRequest,
      lines: [
        { account_id: 'acc-1', line_number: 1, debit: 500, credit: 0 },
        { account_id: 'acc-2', line_number: 2, debit: 0, credit: 300 },
      ],
    })

    expect(result.success).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('passes through the canonical RPC error and fails closed on missing entry id', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'PERIOD_CLOSED' } })
      .mockResolvedValueOnce({ data: { success: false }, error: null })

    await expect(JournalService.createEntry(balancedRequest)).resolves.toEqual({
      success: false,
      error: 'PERIOD_CLOSED',
    })
    await expect(JournalService.createEntry(balancedRequest)).resolves.toEqual({
      success: false,
      error: 'Manual journal RPC returned no entry',
    })
  })
})

describe('JournalService canonical lifecycle RPCs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts through rpc_post_manual_journal_entry', async () => {
    mockRpc.mockResolvedValue({ data: { success: true }, error: null })

    await expect(JournalService.postJournalEntry('entry-post-1')).resolves.toEqual({
      success: true,
      message: 'Entry posted successfully',
    })
    expect(mockRpc).toHaveBeenCalledWith('rpc_post_manual_journal_entry', {
      p_entry_id: 'entry-post-1',
    })
  })

  it('fails posting closed on RPC denial or unsuccessful response', async () => {
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

  it('batch-posts only through the canonical batch RPC', async () => {
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

    await expect(JournalService.batchPostEntries(['e-1', 'e-2'])).resolves.toEqual(rpcResult)
    expect(mockRpc).toHaveBeenCalledWith('rpc_batch_post_manual_journal_entries', {
      p_entry_ids: ['e-1', 'e-2'],
    })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('reverses through rpc_reverse_manual_journal_entry and handles replay', async () => {
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

  it('does not fall back to a legacy reversal function on denial', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'PERMISSION_DENIED' } })

    await expect(JournalService.reverseEntry('e-original')).rejects.toThrow('PERMISSION_DENIED')
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('JournalService related-data helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeOrderedQuery = (data: unknown[], error: unknown = null) => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  })

  it('reads only attachments and comments from active related-data tables', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entry_attachments') return makeOrderedQuery([{ id: 'attachment-1' }])
      if (table === 'journal_entry_comments') return makeOrderedQuery([{ id: 'comment-1' }])
      throw new Error(`unexpected table ${table}`)
    })

    await expect(JournalService.getEntryAttachments('entry-1')).resolves.toEqual([{ id: 'attachment-1' }])
    await expect(JournalService.getEntryComments('entry-1')).resolves.toEqual([{ id: 'comment-1' }])
    expect(mockFrom).not.toHaveBeenCalledWith('journal_entry_approvals')
  })

  it('returns empty lists when attachment/comment reads fail', async () => {
    mockFrom.mockReturnValue(makeOrderedQuery([], { message: 'READ_FAILED' }))

    await expect(JournalService.getEntryAttachments('entry-1')).resolves.toEqual([])
    await expect(JournalService.getEntryComments('entry-1')).resolves.toEqual([])
  })

  it('uploads attachment metadata inside the current tenant', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    mockStorageFrom.mockReturnValue({ upload })
    const single = vi.fn().mockResolvedValue({
      data: { id: 'attachment-1', entry_id: 'entry-1', file_name: 'proof.pdf' },
      error: null,
    })
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    })
    mockFrom.mockReturnValue({ insert })
    const file = { name: 'proof.pdf', size: 12, type: 'application/pdf' } as File

    const result = await JournalService.uploadAttachment('entry-1', file)

    expect(mockStorageFrom).toHaveBeenCalledWith('documents')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      entry_id: 'entry-1',
      org_id: 'org-jtest',
      tenant_id: 'org-jtest',
    }))
    expect(result.id).toBe('attachment-1')
  })

  it('deletes attachments/comments and adds comments through the active tables', async () => {
    const attachmentEq = vi.fn().mockResolvedValue({ error: null })
    const commentDeleteEq = vi.fn().mockResolvedValue({ error: null })
    const commentSingle = vi.fn().mockResolvedValue({
      data: { id: 'comment-2', entry_id: 'entry-1', comment_text: 'note' },
      error: null,
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entry_attachments') {
        return { delete: vi.fn().mockReturnValue({ eq: attachmentEq }) }
      }
      if (table === 'journal_entry_comments') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: commentSingle }),
          }),
          delete: vi.fn().mockReturnValue({ eq: commentDeleteEq }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    await expect(JournalService.deleteAttachment('attachment-1')).resolves.toBeUndefined()
    await expect(JournalService.addComment('entry-1', 'note', 'internal')).resolves.toEqual(
      expect.objectContaining({ id: 'comment-2' }),
    )
    await expect(JournalService.deleteComment('comment-2')).resolves.toBeUndefined()
  })
})

describe('JournalService.getEntryWithDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds canonical details without touching the retired approval table', async () => {
    const entry = {
      id: 'entry-1',
      org_id: 'org-jtest',
      journal_id: 'journal-1',
      entry_number: 'JE-1',
      entry_date: '2026-08-24',
      status: 'draft',
      total_debit: 100,
      total_credit: 100,
      created_at: '2026-08-24T00:00:00Z',
      updated_at: '2026-08-24T00:00:00Z',
      journals: { name: 'General', name_ar: 'عام' },
    }
    const line = {
      id: 'line-1',
      entry_id: 'entry-1',
      line_number: 1,
      account_id: 'acc-1',
      debit: 100,
      credit: 0,
    }
    const related = (data: unknown[]) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'gl_entries') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: entry, error: null }),
            }),
          }),
        }
      }
      if (table === 'gl_entry_lines') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [line], error: null }),
            }),
          }),
        }
      }
      if (table === 'gl_accounts') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 'acc-1', code: '1000', name: 'Cash', name_ar: 'نقد' }],
            }),
          }),
        }
      }
      if (table === 'journal_entry_attachments') return related([{ id: 'attachment-1' }])
      if (table === 'journal_entry_comments') return related([{ id: 'comment-1' }])
      throw new Error(`unexpected table ${table}`)
    })

    const result = await JournalService.getEntryWithDetails('entry-1')

    expect(result).toEqual(expect.objectContaining({
      id: 'entry-1',
      journal_name: 'General',
      journal_name_ar: 'عام',
      approvals: [],
      attachments: [{ id: 'attachment-1' }],
      comments: [{ id: 'comment-1' }],
    }))
    expect(result?.lines?.[0]).toEqual(expect.objectContaining({
      account_code: '1000',
      account_name: 'Cash',
      account_name_ar: 'نقد',
    }))
    expect(mockFrom).not.toHaveBeenCalledWith('journal_entry_approvals')
    expect(mockRpc).not.toHaveBeenCalledWith('check_entry_approval_required', expect.anything())
    expect(mockRpc).not.toHaveBeenCalledWith('approve_journal_entry', expect.anything())
  })

  it('falls back to the base header with no legacy approval data', async () => {
    let glEntryRead = 0
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'gl_entries') throw new Error(`unexpected table ${table}`)
      glEntryRead += 1
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(
              glEntryRead === 1
                ? { data: null, error: new Error('DETAIL_READ_FAILED') }
                : {
                    data: {
                      id: 'entry-1',
                      org_id: 'org-jtest',
                      journal_id: 'journal-1',
                      entry_number: 'JE-1',
                      entry_date: '2026-08-24',
                      status: 'draft',
                      total_debit: 100,
                      total_credit: 100,
                      created_at: '2026-08-24T00:00:00Z',
                      updated_at: '2026-08-24T00:00:00Z',
                    },
                    error: null,
                  },
            ),
          }),
        }),
      }
    })

    const result = await JournalService.getEntryWithDetails('entry-1')

    expect(result).toEqual(expect.objectContaining({
      id: 'entry-1',
      lines: [],
      approvals: [],
      attachments: [],
      comments: [],
    }))
    expect(glEntryRead).toBe(2)
    expect(mockFrom).not.toHaveBeenCalledWith('journal_entry_approvals')
  })
})
