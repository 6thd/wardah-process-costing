import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProductUomStatus } from '../use-product-uom-status'

const useUomEngineEnabled = vi.fn()
const useAuth = vi.fn()
const listProductUomMappingStatuses = vi.fn()

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => useUomEngineEnabled(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuth(),
}))

vi.mock('@/services/uom-master-data-service', () => ({
  listProductUomMappingStatuses: (...args: unknown[]) => listProductUomMappingStatuses(...args),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useProductUomStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ currentOrgId: 'org-1' })
  })

  it('never gates and never queries while the engine is disabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false })

    const { result } = renderHook(() => useProductUomStatus(), { wrapper })

    expect(result.current.needsSetup('p-2')).toBe(false)
    expect(listProductUomMappingStatuses).not.toHaveBeenCalled()
  })

  it('gates everything while the projection is still loading', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true })
    listProductUomMappingStatuses.mockReturnValue(new Promise(() => {})) // never resolves

    const { result } = renderHook(() => useProductUomStatus(), { wrapper })

    expect(result.current.isSuccess).toBe(false)
    expect(result.current.needsSetup('p-1')).toBe(true) // fail-closed during load
  })

  it('gates everything after the projection query fails', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true })
    listProductUomMappingStatuses.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useProductUomStatus(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.needsSetup('p-1')).toBe(true) // fail-closed on error
  })

  it('gates non-mapped and unknown products once the projection succeeds', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true })
    listProductUomMappingStatuses.mockResolvedValue([
      { id: 'p-1', uom_migration_status: 'MAPPED' },
      { id: 'p-2', uom_migration_status: 'NO_UNIT' },
    ])

    const { result } = renderHook(() => useProductUomStatus(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.needsSetup('p-1')).toBe(false) // mapped
    expect(result.current.needsSetup('p-2')).toBe(true) // non-mapped
    expect(result.current.needsSetup('unknown')).toBe(true) // fail-closed: unknown → gated
    expect(listProductUomMappingStatuses).toHaveBeenCalledWith('org-1')
  })
})
