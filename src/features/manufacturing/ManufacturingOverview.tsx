/**
 * Manufacturing Overview
 * لوحة نظرة عامة على التصنيع
 *
 * مستخرجة إلى ملفها الخاص (بدل تعريفها داخل index.tsx) على غرار
 * ManufacturingMetrics/ManufacturingCards/RecentOrders — يتيح اختبارها
 * بمعزل عن سطح الاستيراد الضخم لموديول التصنيع بالكامل.
 */

import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/page-header'
import { usePermissions } from '@/hooks/usePermissions'
import { useManufacturingOrders } from './hooks/useManufacturingOrders'
import { ManufacturingMetrics } from './components/ManufacturingMetrics'
import { ManufacturingCards } from './components/ManufacturingCards'
import { RecentOrders } from './components/RecentOrders'

export function ManufacturingOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const { hasPermissionKey } = usePermissions()
  // متطلب دخول هذه الشاشة عند ModuleGuard هو anyOf بين موارد التصنيع؛ كل قسم
  // هنا مشروط بمفتاح قراءته الفعلي. useManufacturingOrders(enabled) يمنع
  // React Query من الجلب أصلاً لمستخدم دخل بمفتاح آخر (bom/stage/work_center)
  // بلا manufacturing.orders.read — لا Rules of Hooks مكسورة: الـhook يُستدعى
  // دومًا، enabled فقط يقرر تشغيل الاستعلام.
  const canReadOrders = hasPermissionKey('manufacturing.orders.read')
  const canReadBoms = hasPermissionKey('manufacturing.boms.read')
  const canReadWorkCenters = hasPermissionKey('manufacturing.work_centers.read')
  const canReadStageCosts = hasPermissionKey('manufacturing.stage_costs.read')
  // بطاقة الجودة تعتمد حاليًا على manufacturing.orders.read في العقد (صفحة
  // "قيد الإنشاء" بلا مورد مخصص بعد).
  const { orders, loading } = useManufacturingOrders({ enabled: canReadOrders })

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('manufacturing.title')}
        titleClassName="wardah-text-gradient-google"
        description={t('manufacturing.overviewPage.subtitle')}
        hideOnPrint={false}
      />

      {/* Key Metrics — مشتقة كلها من orders */}
      {canReadOrders && <ManufacturingMetrics orders={orders} isRTL={isRTL} t={t} />}

      {/* Manufacturing Functions Grid — كل بطاقة برابطها الخاص مشروطة بمفتاحها */}
      <ManufacturingCards
        orders={orders}
        isRTL={isRTL}
        t={t}
        canReadOrders={canReadOrders}
        canReadBoms={canReadBoms}
        canReadWorkCenters={canReadWorkCenters}
        canReadStageCosts={canReadStageCosts}
      />

      {/* Recent Manufacturing Orders — مشتقة من orders */}
      {canReadOrders && <RecentOrders orders={orders} loading={loading} isRTL={isRTL} t={t} />}
    </div>
  )
}

export default ManufacturingOverview
