import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getQualityPolicy } from '@/services/manufacturing-settings-service'
import { MaterialIssueTab } from './MaterialIssueTab'
import { QualityTab } from './QualityTab'
import { GlMappingsTab } from './GlMappingsTab'
import { CostPolicyTab } from './CostPolicyTab'
import { settingsErrorMessage } from './settingsError'
import { QUALITY_POLICY_QUERY_KEY } from './queryKeys'

/**
 * بيت إعدادات التصنيع (قرار المالك D1). التبويبات الثلاثة الأولى تقرأ وتكتب بعقود
 * مطبّقة؛ تبويب سياسات التكلفة يعتمد على Migration 204 ويعرض «غير متاح» حيث لم
 * تُطبَّق، ويأخذ قدرة الحفظ من `capabilities.can_manage` في 204. لا يظهر هنا إعداد
 * بلا مسار حفظ مأذون (معدلات مراكز العمل، المراحل، BOM — انظر §0 في جرد إعدادات التصنيع).
 *
 * الحفظ يتبع `can_manage_policy` الذي تحسبه قاعدة البيانات بمحدِّد M201 نفسه
 * الذي يحرس الكتّاب الثلاثة، لا مفاتيح الواجهة.
 */
export function ManufacturingSettingsPage() {
  const { t, i18n } = useTranslation()
  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const quality = useQuery({ queryKey: QUALITY_POLICY_QUERY_KEY, queryFn: getQualityPolicy })
  const canManage = quality.data?.canManage === true

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
