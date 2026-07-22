import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

const getProductUomOptions = vi.fn()
const authState: { currentOrgId: string | null } = { currentOrgId: 'org-1' }

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: authState.currentOrgId }),
}))

vi.mock('@/services/uom-service', () => ({
  getProductUomOptions: (productId: string) => getProductUomOptions(productId),
}))

import { productUomsQueryKey, useProductUoms } from '../use-product-uoms'

function wrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useProductUoms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.currentOrgId = 'org-1'
  })

  it('does not query without a product', () => {
    const { result } = renderHook(() => useProductUoms(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(getProductUomOptions).not.toHaveBeenCalled()
  })

  it('does not query without an active organization', () => {
    authState.currentOrgId = null
    const { result } = renderHook(() => useProductUoms('product-1'), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(getProductUomOptions).not.toHaveBeenCalled()
  })

  it('loads options for the selected product', async () => {
    getProductUomOptions.mockResolvedValue([{ id: 'uom-1', is_base: true }])
    const { result } = renderHook(() => useProductUoms('product-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(getProductUomOptions).toHaveBeenCalledWith('product-1')
    expect(result.current.data).toEqual([{ id: 'uom-1', is_base: true }])
  })

  it('partitions cache by organization and product', () => {
    expect(productUomsQueryKey('org-1', 'product-1')).not.toEqual(
      productUomsQueryKey('org-2', 'product-1'),
    )
    expect(productUomsQueryKey('org-1', 'product-1')).not.toEqual(
      productUomsQueryKey('org-1', 'product-2'),
    )
  })
})
