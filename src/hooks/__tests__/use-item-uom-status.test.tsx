import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useItemUomStatus } from '../use-item-uom-status'

const useUomEngineEnabled = vi.fn()
const useAuth = vi.fn()
const listItemUomMappingStatuses = vi.fn()

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => useUomEngineEnabled(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuth(),
}))

vi.mock('@/services/uom-master-data-service', () => ({
  listItemUomMappingStatuses: (...args: unknown[]) => listItemUomMappingStatuses(...args),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useItemUomStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ currentOrgId: 'org-1' })
  })

  it('never gates and never queries while the engine is disabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false })

    const { result } = renderHook(() => useItemUomStatus(), { wrapper })

    expect(result.current.needsSetup('i-2')).toBe(false)
    expect(listItemUomMappingStatuses).not.toHaveBeenCalled()
  })

  it('gates only known non-mapped items when the engine is enabled', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true })
    listItemUomMappingStatuses.mockResolvedValue([
      { id: 'i-1', uom_migration_status: 'MAPPED' },
      { id: 'i-2', uom_migration_status: 'NO_UNIT' },
    ])

    const { result } = renderHook(() => useItemUomStatus(), { wrapper })

    await waitFor(() => expect(result.current.statusById.size).toBe(2))

    expect(result.current.needsSetup('i-1')).toBe(false) // mapped
    expect(result.current.needsSetup('i-2')).toBe(true) // non-mapped
    expect(result.current.needsSetup('unknown')).toBe(false) // not loaded → not gated
    expect(listItemUomMappingStatuses).toHaveBeenCalledWith('org-1')
  })
})
