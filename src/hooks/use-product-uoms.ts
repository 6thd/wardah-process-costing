import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getProductUomOptions } from '@/services/uom-service'

export const PRODUCT_UOMS_STALE_TIME_MS = 5 * 60 * 1000

export function productUomsQueryKey(orgId: string | null, productId: string | null) {
  return ['product-uoms', orgId, productId] as const
}

export function useProductUoms(productId: string | null) {
  const { currentOrgId } = useAuth()

  return useQuery({
    queryKey: productUomsQueryKey(currentOrgId, productId),
    queryFn: () => getProductUomOptions(productId as string),
    enabled: Boolean(currentOrgId && productId),
    staleTime: PRODUCT_UOMS_STALE_TIME_MS,
    retry: 1,
  })
}
