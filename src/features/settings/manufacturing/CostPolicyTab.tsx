import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { useAuth } from '@/contexts/AuthContext'
import { discoverCostPolicy205 } from '@/services/mfg-cost-policy-205-service'
import { CostPolicy204Panel, useCostPolicy204Scope } from './CostPolicy204Panel'
import { CostPolicy205Panel } from './CostPolicy205Panel'
import { costPolicy205QueryKey } from './queryKeys'

/**
 * مفتاح رفيع: يقرأ حالة 205 من الخادم ويعرض إحدى لوحتين (التصميم §2 و§3).
 *
 * - `absent` وحده يعرض لوحة 204، ومن فحص منتهٍ فقط: `staleTime: 0`، ويعاد الفحص عند
 *   العودة إلى التبويب، ولا تُعرض لوحة 204 من النتيجة السابقة أثناء إعادة الفحص. فتتحول
 *   الشاشة بعد تطبيق 205 دون نشر جديد.
 * - `denied` و`unknown` لا يعرضان لوحة 204 ولا أي كتابة، ولا يعودان إلى المسار القديم.
 * - القراءة للمؤسسة المختارة، والمفتاح يحملها: تبديلها يقرأ من جديد، ولا يظهر رد مؤسسة سابقة.
 *   ولوحة 204 تأخذ المؤسسة نفسها، ومدخلاتها غير المرسلة تُحفظ هنا لهذه المؤسسة وحدها: تبقى
 *   عبر فحص ينتهي `absent`، وتُمحى حين ينتهي بغيره، ولا تنتقل إلى مؤسسة أخرى.
 */
export function CostPolicyTab() {
  const { t } = useTranslation()
  const { currentOrgId } = useAuth()
  const discovery = useQuery({
    queryKey: costPolicy205QueryKey(currentOrgId),
    queryFn: () => discoverCostPolicy205(currentOrgId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: false,
  })
  const { scope, clear } = useCostPolicy204Scope(currentOrgId)
  const settled = discovery.data?.status
  useEffect(() => {
    if (settled && settled !== 'absent') clear()
  }, [settled, clear])

  if (discovery.isLoading || !discovery.data) return <LoadingSpinner />
  const result = discovery.data
  if (result.status === 'absent' && discovery.isFetching) return <LoadingSpinner />
  switch (result.status) {
    case 'absent':
      return scope ? <CostPolicy204Panel key={scope.orgId} scope={scope} /> : <LoadingSpinner />
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
