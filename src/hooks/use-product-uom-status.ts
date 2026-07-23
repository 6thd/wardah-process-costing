import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useUomEngineEnabled } from '@/hooks/use-uom-engine-enabled'
import { listProductUomMappingStatuses } from '@/services/uom-master-data-service'

export const PRODUCT_UOM_STATUS_STALE_TIME_MS = 5 * 60 * 1000

export function productUomStatusQueryKey(orgId: string | null) {
  return ['product-uom-statuses', orgId] as const
}

/**
 * Provides products.id → uom_migration_status for the active organization so
 * product pickers can disable and badge an unmapped product before the user
 * reaches a hard RPC error. Use this for pickers whose list is sourced from the
 * products table (e.g. `itemsService.getAll()`, which reads `products`).
 *
 * Fail-safe: when the UoM engine is off nothing is gated, and a product whose
 * status was not loaded is never gated (the server still fail-closes).
 */
export function useProductUomStatus() {
  const { currentOrgId } = useAuth()
  const { isEnabled } = useUomEngineEnabled()

  const query = useQuery({
    queryKey: productUomStatusQueryKey(currentOrgId),
    queryFn: () => listProductUomMappingStatuses(currentOrgId as string),
    enabled: isEnabled && Boolean(currentOrgId),
    staleTime: PRODUCT_UOM_STATUS_STALE_TIME_MS,
  })

  const statusById = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of query.data ?? []) map.set(row.id, row.uom_migration_status)
    return map
  }, [query.data])

  const needsSetup = (productId: string): boolean => {
    if (!isEnabled) return false
    const status = statusById.get(productId)
    return status !== undefined && status !== 'MAPPED'
  }

  return { statusById, needsSetup, isEnabled, isLoading: query.isLoading }
}
