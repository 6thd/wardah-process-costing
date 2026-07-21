import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getUomEngineEnabled = vi.fn()
const authState: { currentOrgId: string | null } = { currentOrgId: 'org-1' }

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: authState.currentOrgId }),
}))

vi.mock('@/services/org-settings-service', () => ({
  UOM_ENGINE_SETTING_KEY: 'uom_engine_enabled',
  getUomEngineEnabled: () => getUomEngineEnabled(),
}))

import { uomEngineQueryKey, useUomEngineEnabled } from '../use-uom-engine-enabled'

function wrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useUomEngineEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.currentOrgId = 'org-1'
  })

  it('is fail-closed while loading and enables only on explicit true', async () => {
    getUomEngineEnabled.mockResolvedValue(true)
    const { result } = renderHook(() => useUomEngineEnabled(), { wrapper })

    expect(result.current.isEnabled).toBe(false)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isEnabled).toBe(true)
  })

  it('remains disabled when the stored setting is false', async () => {
    getUomEngineEnabled.mockResolvedValue(false)
    const { result } = renderHook(() => useUomEngineEnabled(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isEnabled).toBe(false)
  })

  it('does not query without an active organization', async () => {
    authState.currentOrgId = null
    const { result } = renderHook(() => useUomEngineEnabled(), { wrapper })

    expect(result.current.isEnabled).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
    expect(getUomEngineEnabled).not.toHaveBeenCalled()
  })

  it('partitions the cache by organization', () => {
    expect(uomEngineQueryKey('org-1')).toEqual([
      'org-settings', 'org-1', 'uom_engine_enabled',
    ])
    expect(uomEngineQueryKey('org-2')).not.toEqual(uomEngineQueryKey('org-1'))
  })
})
