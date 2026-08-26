/**
 * Behavior locks for unchanged canonical JournalService paths.
 *
 * PR #181 retires only the legacy journal approval surface. These tests restore
 * pre-existing protection for canonical create/batch-post and attachment/comment
 * behavior that must remain unchanged by that cleanup.
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

describe('JournalService canonical behavior locks retained by #181', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts the existing 0.01 rounding tolerance for manual journals', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, entry_id: 'e-3', entry_number: 'JE-0003', status: 'draft' },
      error: null,
    })

    const result = await JournalService.createEntry({
      ...balancedRequest,
      lines: [
        { account_id: 'acc-1', line_number: 1, debit: 100.005, credit: 0 },
        { account_id: 'acc-2', line_number: 2, debit: 0, credit: 100 },
      ],
    })

    expect(result.success).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('rpc_create_manual_journal_entry', expect.any(Object))
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('propagates batch-post RPC failures without falling back to legacy paths', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'PERMISSION_DENIED' } })

    await expect(JournalService.batchPostEntries(['e-1'])).rejects.toThrow('PERMISSION_DENIED')
    expect(mockRpc).toHaveBeenCalledWith('rpc_batch_post_manual_journal_entries', {
      p_entry_ids: ['e-1'],
    })
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('uploads attachment bytes and preserves metadata contract inside the current tenant', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    mockStorageFrom.mockReturnValue({ upload })
    const single = vi.fn().mockResolvedValue({
      data: { id: 'attachment-1', entry_id: 'entry-1', file_name: 'proof.pdf' },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    mockFrom.mockReturnValue({ insert })
    const file = { name: 'proof.pdf', size: 12, type: 'application/pdf' } as File

    const result = await JournalService.uploadAttachment('entry-1', file)

    expect(mockStorageFrom).toHaveBeenCalledWith('documents')
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^journal-attachments\/entry-1\/\d+\.pdf$/), file)
    expect(mockFrom).toHaveBeenCalledWith('journal_entry_attachments')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      entry_id: 'entry-1',
      file_name: 'proof.pdf',
      org_id: 'org-jtest',
      tenant_id: 'org-jtest',
    }))
    expect(result.id).toBe('attachment-1')
  })

  it('stops attachment upload before metadata insertion when storage fails', async () => {
    mockStorageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: new Error('UPLOAD_FAILED') }),
    })

    await expect(
      JournalService.uploadAttachment(
        'entry-1',
        { name: 'proof.pdf', size: 12, type: 'application/pdf' } as File,
      ),
    ).rejects.toThrow('UPLOAD_FAILED')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('preserves attachment/comment table operation details', async () => {
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
    expect(attachmentEq).toHaveBeenCalledWith('id', 'attachment-1')
    expect(commentDeleteEq).toHaveBeenCalledWith('id', 'comment-2')
  })

  it('propagates attachment deletion and comment insertion failures', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entry_attachments') {
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: new Error('ATTACHMENT_DELETE_FAILED') }),
          }),
        }
      }
      if (table === 'journal_entry_comments') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: new Error('COMMENT_ADD_FAILED') }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    await expect(JournalService.deleteAttachment('attachment-1')).rejects.toThrow('ATTACHMENT_DELETE_FAILED')
    await expect(JournalService.addComment('entry-1', 'note')).rejects.toThrow('COMMENT_ADD_FAILED')
  })
})
