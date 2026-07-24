import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { listPurchaseProductUoms } from '@/features/purchasing/purchase-order-service'

export const PURCHASE_PRODUCT_UOMS_STALE_TIME_MS = 5 * 60 * 1000

export function purchaseProductUomsQueryKey(orgId: string | null, productId: string | null) {
  return ['purchase-product-uoms', orgId, productId] as const
}

export function usePurchaseProductUoms(productId: string | null) {
  const { currentOrgId } = useAuth()

  return useQuery({
    queryKey: purchaseProductUomsQueryKey(currentOrgId, productId),
    queryFn: () => listPurchaseProductUoms(currentOrgId as string, productId as string),
    enabled: Boolean(currentOrgId && productId),
    staleTime: PURCHASE_PRODUCT_UOMS_STALE_TIME_MS,
    retry: 1,
  })
}
