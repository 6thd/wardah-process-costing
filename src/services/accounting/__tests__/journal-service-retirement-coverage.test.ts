import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: vi.fn(),
    storage: { from: vi.fn() },
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-jtest')),
}))

import { JournalService } from '../journal-service'

function singleResult(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

describe('JournalService retired approval fallback coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when the detail read fails and the fallback header is absent', async () => {
    mockFrom
      .mockReturnValueOnce(singleResult({ data: null, error: new Error('DETAIL_READ_FAILED') }))
      .mockReturnValueOnce(singleResult({ data: null, error: null }))

    await expect(JournalService.getEntryWithDetails('missing-entry')).resolves.toBeNull()
    expect(mockFrom).toHaveBeenCalledTimes(2)
    expect(mockFrom).not.toHaveBeenCalledWith('journal_entry_approvals')
  })

  it('returns null when the fallback header read itself throws', async () => {
    mockFrom
      .mockReturnValueOnce(singleResult({ data: null, error: new Error('DETAIL_READ_FAILED') }))
      .mockImplementationOnce(() => {
        throw new Error('FALLBACK_READ_FAILED')
      })

    await expect(JournalService.getEntryWithDetails('broken-entry')).resolves.toBeNull()
    expect(mockFrom).toHaveBeenCalledTimes(2)
    expect(mockFrom).not.toHaveBeenCalledWith('journal_entry_approvals')
  })
})
