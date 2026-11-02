import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { discoverCostPolicy205 } from '@/services/mfg-cost-policy-205-service'
import { CostPolicy204Panel } from './CostPolicy204Panel'
import { CostPolicy205Panel } from './CostPolicy205Panel'
import { COST_POLICY_205_QUERY_KEY } from './queryKeys'

/**
 * مفتاح رفيع: يقرأ حالة 205 من الخادم ويعرض إحدى لوحتين (التصميم §2 و§3).
 *
 * - `absent` وحده يعرض لوحة 204. لا يبقى في الذاكرة: `staleTime: 0`، ويعاد الفحص عند
 *   العودة إلى التبويب، فتتحول الشاشة بعد تطبيق 205 دون نشر جديد.
 * - `denied` و`unknown` لا يعرضان لوحة 204 ولا أي كتابة، ولا يعودان إلى المسار القديم.
 */
export function CostPolicyTab() {
  const { t } = useTranslation()
  const discovery = useQuery({
    queryKey: COST_POLICY_205_QUERY_KEY,
    queryFn: discoverCostPolicy205,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: false,
  })

  if (discovery.isLoading || !discovery.data) return <LoadingSpinner />
  const result = discovery.data
  switch (result.status) {
    case 'absent':
      return <CostPolicy204Panel />
    case 'present':
      return <CostPolicy205Panel state={result.state} />
    case 'denied':
      return (
        <Alert variant="destructive" data-testid="cp205-denied">
          <AlertDescription>{t('manufacturingSettings.costPolicy205.denied')}</AlertDescription>
        </Alert>
      )
    default:
      return (
        <Alert variant="destructive" data-testid="cp205-unknown">
          <AlertDescription className="space-y-2">
            <p>{t('manufacturingSettings.costPolicy205.unknown')}</p>
            <p className="font-mono text-xs">{result.reason}</p>
            <Button size="sm" variant="outline" disabled={discovery.isFetching} onClick={() => void discovery.refetch()}>
              {t('manufacturingSettings.costPolicy205.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )
  }
}
