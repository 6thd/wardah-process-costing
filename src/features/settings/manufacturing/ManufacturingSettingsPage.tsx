import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { usePermissions } from '@/hooks/usePermissions'
import { getQualityPolicy } from '@/services/manufacturing-settings-service'
import { MaterialIssueTab } from './MaterialIssueTab'
import { QualityTab } from './QualityTab'
import { GlMappingsTab } from './GlMappingsTab'
import { CostPolicyTab } from './CostPolicyTab'
import { settingsErrorMessage } from './settingsError'
import { QUALITY_POLICY_QUERY_KEY } from './queryKeys'

/**
 * بيت إعدادات التصنيع (قرار المالك D1). التبويبات الثلاثة الأولى تقرأ وتكتب بعقود
 * مطبّقة؛ تبويب سياسات التكلفة يكتشف Migration 205 من الخادم: يعرض لوحة 205 للقراءة
 * إن وُجدت، ولوحة 204 إن غابت، ولا يعرض أيًا منهما عند الرفض أو الخطأ. لا يظهر هنا إعداد
 * بلا مسار حفظ مأذون (معدلات مراكز العمل، المراحل، BOM — انظر §0 في جرد إعدادات التصنيع).
 *
 * الحفظ يتبع `can_manage_policy` الذي تحسبه قاعدة البيانات بمحدِّد M201 نفسه
 * الذي يحرس الكتّاب الثلاثة، لا مفاتيح الواجهة.
 */
export function ManufacturingSettingsPage() {
  const { t, i18n } = useTranslation()
  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  // The view follows the permission keys the backend reports for the selected organization (the
  // snapshot the route guard reads), not a settings-read error: rpc_get_quality_policy checks
  // membership only (M201), so it never refuses a holder of manufacturing.cost_policy.approve alone.
  const { hasPermissionKey, loading: permissionsLoading } = usePermissions()
  const costPolicyOnly = !permissionsLoading
    && hasPermissionKey('manufacturing.cost_policy.approve')
    && !hasPermissionKey('manufacturing.settings.read')
    && !hasPermissionKey('manufacturing.settings.update')
  const quality = useQuery({
    queryKey: QUALITY_POLICY_QUERY_KEY,
    queryFn: getQualityPolicy,
    enabled: !permissionsLoading && !costPolicyOnly,
  })
  const canManage = quality.data?.canManage === true

  // No tab mounts, and none reads, before the view is known.
  if (permissionsLoading) return <LoadingSpinner />

  // A holder of manufacturing.cost_policy.approve without the settings keys (Migration 205) sees
  // the cost-policy tab alone, open (205 design §13).
  if (costPolicyOnly) {
    return (
      <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <PageHeader
          title={t('manufacturingSettings.title')}
          description={t('manufacturingSettings.description')}
          hideOnPrint={false}
        />
        <Alert>
          <AlertDescription>{t('manufacturingSettings.costPolicyOnlyNotice')}</AlertDescription>
        </Alert>
        <CostPolicyTab />
      </div>
    )
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        title={t('manufacturingSettings.title')}
        description={t('manufacturingSettings.description')}
        hideOnPrint={false}
      />

      {quality.isError && (
        <Alert variant="destructive">
          <AlertDescription>{settingsErrorMessage(t, quality.error)}</AlertDescription>
        </Alert>
      )}
      {quality.isSuccess && !canManage && (
        <Alert>
          <AlertDescription>{t('manufacturingSettings.readOnlyNotice')}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="material-issue" dir={isRTL ? 'rtl' : 'ltr'}>
        <TabsList>
          <TabsTrigger value="material-issue">{t('manufacturingSettings.tabs.materialIssue')}</TabsTrigger>
          <TabsTrigger value="quality">{t('manufacturingSettings.tabs.quality')}</TabsTrigger>
          <TabsTrigger value="gl-mappings">{t('manufacturingSettings.tabs.glMappings')}</TabsTrigger>
          <TabsTrigger value="cost-policies">{t('manufacturingSettings.tabs.costPolicies')}</TabsTrigger>
        </TabsList>
        <TabsContent value="material-issue">
          <MaterialIssueTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="quality">
          <QualityTab />
        </TabsContent>
        <TabsContent value="gl-mappings">
          <GlMappingsTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="cost-policies">
          <CostPolicyTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
