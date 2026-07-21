import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  getUomEngineEnabled,
  UOM_ENGINE_SETTING_KEY,
} from '@/services/org-settings-service'

export const UOM_ENGINE_QUERY_STALE_TIME_MS = 5 * 60 * 1000

export function uomEngineQueryKey(orgId: string | null) {
  return ['org-settings', orgId, UOM_ENGINE_SETTING_KEY] as const
}

/**
 * يقرأ علم إطلاق محرك الوحدات للمؤسسة النشطة.
 * Fail-closed: غياب المؤسسة أو الإعداد أو أثناء التحميل يعني أن الواجهة الجديدة معطلة.
 */
export function useUomEngineEnabled() {
  const { currentOrgId } = useAuth()
  const query = useQuery({
    queryKey: uomEngineQueryKey(currentOrgId),
    queryFn: getUomEngineEnabled,
    enabled: Boolean(currentOrgId),
    staleTime: UOM_ENGINE_QUERY_STALE_TIME_MS,
    retry: 1,
  })

  return {
    ...query,
    isEnabled: currentOrgId !== null && query.data === true,
  }
}
