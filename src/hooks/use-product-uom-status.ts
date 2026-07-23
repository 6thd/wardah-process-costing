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
 * Fail-closed while the engine is on: until the projection has loaded successfully
 * every product is treated as needing setup (so nothing is selectable during
 * loading or after a failed query), and a product missing from a successful
 * projection is also treated as needing setup. When the engine is off nothing is
 * gated.
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
    // Fail-closed: loading, error, or an unknown/non-MAPPED product all gate.
    if (!query.isSuccess) return true
    return statusById.get(productId) !== 'MAPPED'
  }

  return {
    statusById,
    needsSetup,
    isEnabled,
    isLoading: query.isLoading,
    isError: query.isError,
    isSuccess: query.isSuccess,
  }
}
