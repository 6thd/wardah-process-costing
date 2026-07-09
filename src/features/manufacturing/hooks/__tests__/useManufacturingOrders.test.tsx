/**
 * اختبارات useManufacturingOrders الموحَّد على React Query (بند 11)
 * تثبت أن الواجهة { orders, loading, loadOrders } لم تتغير
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockGetAll = vi.fn()

vi.mock('@/services/supabase-service', () => ({
  manufacturingService: { getAll: (...args: unknown[]) => mockGetAll(...args) },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {},
  getEffectiveTenantId: vi.fn(() => Promise.resolve(null)),
}))

import { useManufacturingOrders, MANUFACTURING_ORDERS_QUERY_KEY } from '../useManufacturingOrders'
import { useManufacturingProducts } from '../useManufacturingProducts'

function wrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useManufacturingOrders (React Query — بند 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('يحمّل الأوامر ويرجعها بنفس الواجهة القديمة { orders, loading, loadOrders }', async () => {
    const orders = [{ id: 'mo-1', order_number: 'MO-001', status: 'draft' }]
    mockGetAll.mockResolvedValue(orders)

    const { result } = renderHook(() => useManufacturingOrders(), { wrapper })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.orders).toEqual(orders)
    expect(typeof result.current.loadOrders).toBe('function')
  })

  it('يستخدم نفس مفتاح الكاش المشترك مع hooks/use-manufacturing', () => {
    expect(MANUFACTURING_ORDERS_QUERY_KEY).toEqual(['manufacturing-orders'])
  })

  it('جدول غير موجود (PGRST205) ⇒ قائمة فارغة بدون كسر', async () => {
    mockGetAll.mockRejectedValue({ code: 'PGRST205', message: 'Could not find the table' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useManufacturingOrders(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.orders).toEqual([])
    warnSpy.mockRestore()
  })

  it('خطأ حقيقي ⇒ toast + قائمة فارغة (نفس السلوك القديم)', async () => {
    mockGetAll.mockRejectedValue(new Error('network down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { toast } = await import('sonner')

    const { result } = renderHook(() => useManufacturingOrders(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.orders).toEqual([])
    expect(toast.error).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('loadOrders يعيد الجلب (invalidate) — بيانات جديدة تظهر', async () => {
    mockGetAll.mockResolvedValueOnce([{ id: 'mo-1' }])

    const { result } = renderHook(() => useManufacturingOrders(), { wrapper })
    await waitFor(() => expect(result.current.orders).toHaveLength(1))

    mockGetAll.mockResolvedValueOnce([{ id: 'mo-1' }, { id: 'mo-2' }])
    await result.current.loadOrders()

    await waitFor(() => expect(result.current.orders).toHaveLength(2))
    expect(mockGetAll).toHaveBeenCalledTimes(2)
  })
})

describe('useManufacturingProducts (React Query — بند 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('يرجع نفس الواجهة القديمة { products, loading, loadProducts } — وفشل الجلب لا يكسر النموذج', async () => {
    // supabase mock فارغ ⇒ fetchProducts يلتقط الخطأ ويرجع []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useManufacturingProducts(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.products).toEqual([])
    expect(typeof result.current.loadProducts).toBe('function')
    warnSpy.mockRestore()
  })
})
