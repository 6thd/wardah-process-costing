/**
 * @fileoverview useInventory Hook
 * @description React Hook للتعامل مع خدمة المخزون
 * 
 * استخدام:
 * ```tsx
 * const { products, loading, error, refetch } = useInventory()
 * const { transferStock, adjustStock, loading: actionLoading } = useInventoryActions()
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { 
  getInventoryAppService, 
  type ProductListFilters,
  type ProductListResult,
  type StockAdjustmentInput,
  type StockTransferInput
} from '@/application/services'
import type { ProductData, AvailabilityCheckResult } from '@/domain/interfaces'

// ===== useInventory Hook =====

interface UseInventoryOptions extends ProductListFilters {
  enabled?: boolean
}

interface UseInventoryReturn {
  products: ProductData[]
  total: number
  page: number
  hasMore: boolean
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  setFilters: (filters: ProductListFilters) => void
  nextPage: () => void
  prevPage: () => void
}

/**
 * Hook للحصول على قائمة المنتجات
 */
export function useInventory(options: UseInventoryOptions = {}): UseInventoryReturn {
  const { enabled = true, ...initialFilters } = options
  
  const [data, setData] = useState<ProductListResult | null>(null)
  const [filters, setFilters] = useState<ProductListFilters>(initialFilters)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getInventoryAppService(), [])

  const fetchProducts = useCallback(async () => {
    if (!enabled) return
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getProducts(filters)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, filters, enabled])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  const nextPage = useCallback(() => {
    if (data?.hasMore) {
      setFilters(prev => ({ ...prev, page: (prev.page || 1) + 1 }))
    }
  }, [data?.hasMore])

  const prevPage = useCallback(() => {
    setFilters(prev => ({ ...prev, page: Math.max(1, (prev.page || 1) - 1) }))
  }, [])

  return {
    products: data?.products || [],
    total: data?.total || 0,
    page: data?.page || 1,
    hasMore: data?.hasMore || false,
    loading,
    error,
    refetch: fetchProducts,
    setFilters,
    nextPage,
    prevPage
  }
}

// ===== useProduct Hook =====

interface UseProductReturn {
  product: ProductData | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook للحصول على منتج واحد
 */
export function useProduct(productId: string | null): UseProductReturn {
  const [product, setProduct] = useState<ProductData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getInventoryAppService(), [])

  const fetchProduct = useCallback(async () => {
    if (!productId) {
      setProduct(null)
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getProduct(productId)
      setProduct(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, productId])

  useEffect(() => {
    fetchProduct()
  }, [fetchProduct])

  return { product, loading, error, refetch: fetchProduct }
}

// ===== useLowStockProducts Hook =====

/**
 * Hook للحصول على المنتجات ذات المخزون المنخفض
 */
export function useLowStockProducts() {
  const [products, setProducts] = useState<ProductData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getInventoryAppService(), [])

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getLowStockProducts()
      setProducts(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  return { products, loading, error, refetch: fetchProducts }
}

// ===== useInventoryActions Hook =====

interface UseInventoryActionsReturn {
  adjustStock: (input: StockAdjustmentInput) => Promise<void>
  transferStock: (input: StockTransferInput) => Promise<void>
  checkAvailability: (productId: string, quantity: number, warehouseId?: string) => Promise<AvailabilityCheckResult>
  createReservation: (productId: string, quantity: number, reference: string) => Promise<string>
  cancelReservation: (reservationId: string) => Promise<void>
  loading: boolean
  error: Error | null
}

/**
 * Hook لعمليات المخزون (تعديل، نقل، حجز)
 */
export function useInventoryActions(): UseInventoryActionsReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getInventoryAppService(), [])

  const adjustStock = useCallback(async (input: StockAdjustmentInput) => {
    setLoading(true)
    setError(null)
    
    try {
      await service.adjustStock(input)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('حدث خطأ غير متوقع')
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [service])

  const transferStock = useCallback(async (input: StockTransferInput) => {
    setLoading(true)
    setError(null)
    
    try {
      await service.transferStock(input)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('حدث خطأ غير متوقع')
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [service])

  const checkAvailability = useCallback(async (
    productId: string, 
    quantity: number, 
    warehouseId?: string
  ) => {
    return service.checkAvailability(productId, quantity, warehouseId)
  }, [service])

  const createReservation = useCallback(async (
    productId: string, 
    quantity: number, 
    reference: string
  ) => {
    setLoading(true)
    try {
      return await service.createReservation(productId, quantity, reference)
    } finally {
      setLoading(false)
    }
  }, [service])

  const cancelReservation = useCallback(async (reservationId: string) => {
    setLoading(true)
    try {
      await service.cancelReservation(reservationId)
    } finally {
      setLoading(false)
    }
  }, [service])

  return {
    adjustStock,
    transferStock,
    checkAvailability,
    createReservation,
    cancelReservation,
    loading,
    error
  }
}

// ===== useStockValue Hook =====

/**
 * Hook للحصول على إجمالي قيمة المخزون
 */
export function useStockValue(warehouseId?: string) {
  const [value, setValue] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getInventoryAppService(), [])

  const fetchValue = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getTotalStockValue(warehouseId)
      setValue(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, warehouseId])

  useEffect(() => {
    fetchValue()
  }, [fetchValue])

  return { value, loading, error, refetch: fetchValue }
}
