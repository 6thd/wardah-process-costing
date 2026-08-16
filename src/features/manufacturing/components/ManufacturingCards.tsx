/**
 * Manufacturing Cards Component
 * مكون بطاقات التصنيع
 */

import React, { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Factory,
  BarChart3,
  Settings,
  Package,
  CheckCircle,
  Users,
  Layers
} from 'lucide-react'
import type { ManufacturingOrder } from '@/lib/supabase'
import { type ManufacturingOrderStatus, isActiveOrder } from '@/utils/manufacturing-order-status'

interface ManufacturingCardsProps {
  orders: ManufacturingOrder[]
  isRTL: boolean
  t: (key: string) => string
  /** كل مفتاح يطابق متطلب المسار الفعلي الذي تقود إليه البطاقة في route-permissions.ts. */
  canReadOrders: boolean
  canReadBoms: boolean
  canReadWorkCenters: boolean
  canReadStageCosts: boolean
  canReadStages: boolean
}

interface ManufacturingLinkCardProps {
  readonly to: string
  readonly icon: React.ComponentType<{ className?: string }>
  readonly iconClassName: string
  readonly title: string
  readonly description: string
  readonly isRTL: boolean
  readonly children?: ReactNode
}

function ManufacturingLinkCard({
  to,
  icon: Icon,
  iconClassName,
  title,
  description,
  isRTL,
  children,
}: ManufacturingLinkCardProps) {
  return (
    <Link to={to} className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
      <div className={cn('flex items-center gap-3 mb-3', isRTL ? 'flex-row-reverse' : '')}>
        <Icon className={cn('h-6 w-6', iconClassName)} />
        <h3 className={cn('font-semibold wardah-text-gradient-google', isRTL ? 'text-right' : 'text-left')}>
          {title}
        </h3>
      </div>
      <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
        {description}
      </p>
      {children}
    </Link>
  )
}

function LaborCard({ isRTL, t }: Readonly<Pick<ManufacturingCardsProps, 'isRTL' | 't'>>) {
  return (
    <div className="wardah-glass-card wardah-glass-card-hover p-6">
      <div className={cn('flex items-center gap-3 mb-3', isRTL ? 'flex-row-reverse' : '')}>
        <Users className="h-6 w-6 text-secondary" />
        <h3 className={cn('font-semibold wardah-text-gradient-google', isRTL ? 'text-right' : 'text-left')}>
          {t('manufacturing.overviewPage.cards.labor.title')}
        </h3>
      </div>
      <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
        {t('manufacturing.overviewPage.cards.labor.description')}
      </p>
      <Badge variant="outline" className="mt-3">
        {t('manufacturing.overviewPage.cards.labor.badge')}
      </Badge>
    </div>
  )
}

export const ManufacturingCards: React.FC<ManufacturingCardsProps> = ({
  orders,
  isRTL,
  t,
  canReadOrders,
  canReadBoms,
  canReadWorkCenters,
  canReadStageCosts,
  canReadStages,
}) => {
  const activeOrders = orders.filter(order => isActiveOrder(order.status as ManufacturingOrderStatus))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {canReadOrders && (
        <ManufacturingLinkCard
          to="/manufacturing/orders"
          icon={Factory}
          iconClassName="text-primary"
          title={t('manufacturing.overviewPage.cards.orders.title')}
          description={t('manufacturing.overviewPage.cards.orders.description')}
          isRTL={isRTL}
        >
          <div className="flex items-center gap-2 mt-3">
            <Badge variant="secondary">
              {t('manufacturing.overviewPage.cards.orders.activeBadge').replace('{count}', activeOrders.length.toString())}
            </Badge>
            <Badge variant="outline">
              {t('manufacturing.overviewPage.cards.orders.totalBadge').replace('{count}', orders.length.toString())}
            </Badge>
          </div>
        </ManufacturingLinkCard>
      )}

      {canReadStageCosts && (
        <ManufacturingLinkCard
          to="/manufacturing/process-costing"
          icon={BarChart3}
          iconClassName="text-success"
          title={t('manufacturing.overviewPage.cards.processCosting.title')}
          description={t('manufacturing.overviewPage.cards.processCosting.description')}
          isRTL={isRTL}
        >
          <Badge variant="default" className="mt-3">
            {t('manufacturing.overviewPage.cards.processCosting.badge')}
          </Badge>
        </ManufacturingLinkCard>
      )}

      {canReadWorkCenters && (
        <ManufacturingLinkCard
          to="/manufacturing/workcenters"
          icon={Settings}
          iconClassName="text-info"
          title={t('manufacturing.overviewPage.cards.workCenters.title')}
          description={t('manufacturing.overviewPage.cards.workCenters.description')}
          isRTL={isRTL}
        />
      )}

      {canReadBoms && (
        <ManufacturingLinkCard
          to="/manufacturing/bom"
          icon={Package}
          iconClassName="text-warning"
          title={t('manufacturing.overviewPage.cards.bom.title')}
          description={t('manufacturing.overviewPage.cards.bom.description')}
          isRTL={isRTL}
        />
      )}

      {canReadStages && (
        <ManufacturingLinkCard
          to="/manufacturing/stages"
          icon={Layers}
          iconClassName="text-primary"
          title={t('manufacturing.overviewPage.cards.stages.title')}
          description={t('manufacturing.overviewPage.cards.stages.description')}
          isRTL={isRTL}
        />
      )}

      {/* الجودة مربوطة في route-permissions.ts بـ manufacturing.orders.read
          (لا مورد "quality" مخصص بعد — صفحة قيد الإنشاء بلا بيانات). */}
      {canReadOrders && (
        <ManufacturingLinkCard
          to="/manufacturing/quality"
          icon={CheckCircle}
          iconClassName="text-success"
          title={t('manufacturing.overviewPage.cards.quality.title')}
          description={t('manufacturing.overviewPage.cards.quality.description')}
          isRTL={isRTL}
        />
      )}

      <LaborCard isRTL={isRTL} t={t} />
    </div>
  )
}
