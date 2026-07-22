import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useUomEngineEnabled } from '@/hooks/use-uom-engine-enabled'
import { listItemUomMappingStatuses } from '@/services/uom-master-data-service'

export const ITEM_UOM_STATUS_STALE_TIME_MS = 5 * 60 * 1000

export function itemUomStatusQueryKey(orgId: string | null) {
  return ['item-uom-statuses', orgId] as const
}

/**
 * Provides id → uom_migration_status for the active organization's items so item
 * pickers can disable and badge an unmapped item before the user reaches a hard
 * RPC error. Fail-safe: when the UoM engine is off, nothing is gated, and an item
 * whose status was not loaded is never gated (the server still fail-closes).
 */
export function useItemUomStatus() {
  const { currentOrgId } = useAuth()
  const { isEnabled } = useUomEngineEnabled()

  const query = useQuery({
    queryKey: itemUomStatusQueryKey(currentOrgId),
    queryFn: () => listItemUomMappingStatuses(currentOrgId as string),
    enabled: isEnabled && Boolean(currentOrgId),
    staleTime: ITEM_UOM_STATUS_STALE_TIME_MS,
  })

  const statusById = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of query.data ?? []) map.set(row.id, row.uom_migration_status)
    return map
  }, [query.data])

  const needsSetup = (itemId: string): boolean => {
    if (!isEnabled) return false
    const status = statusById.get(itemId)
    return status !== undefined && status !== 'MAPPED'
  }

  return { statusById, needsSetup, isEnabled, isLoading: query.isLoading }
}
