/**
 * Manufacturing Cards Component
 * مكون بطاقات التصنيع
 */

import React from 'react'
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
        <Link to="/manufacturing/orders" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Factory className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.orders.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.orders.description')}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Badge variant="secondary">
              {t('manufacturing.overviewPage.cards.orders.activeBadge').replace('{count}', activeOrders.length.toString())}
            </Badge>
            <Badge variant="outline">
              {t('manufacturing.overviewPage.cards.orders.totalBadge').replace('{count}', orders.length.toString())}
            </Badge>
          </div>
        </Link>
      )}

      {canReadStageCosts && (
        <Link to="/manufacturing/process-costing" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <BarChart3 className="h-6 w-6 text-success" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.processCosting.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.processCosting.description')}
          </p>
          <Badge variant="default" className="mt-3">
            {t('manufacturing.overviewPage.cards.processCosting.badge')}
          </Badge>
        </Link>
      )}

      {canReadWorkCenters && (
        <Link to="/manufacturing/workcenters" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Settings className="h-6 w-6 text-info" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.workCenters.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.workCenters.description')}
          </p>
        </Link>
      )}

      {canReadBoms && (
        <Link to="/manufacturing/bom" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Package className="h-6 w-6 text-warning" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.bom.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.bom.description')}
          </p>
        </Link>
      )}

      {canReadStages && (
        <Link to="/manufacturing/stages" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Layers className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.stages.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.stages.description')}
          </p>
        </Link>
      )}

      {/* الجودة مربوطة في route-permissions.ts بـ manufacturing.orders.read
          (لا مورد "quality" مخصص بعد — صفحة قيد الإنشاء بلا بيانات). */}
      {canReadOrders && (
        <Link to="/manufacturing/quality" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <CheckCircle className="h-6 w-6 text-success" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.quality.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.quality.description')}
          </p>
        </Link>
      )}

      <div className="wardah-glass-card wardah-glass-card-hover p-6">
        <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
          <Users className="h-6 w-6 text-secondary" />
          <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.labor.title')}
          </h3>
        </div>
        <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
          {t('manufacturing.overviewPage.cards.labor.description')}
        </p>
        <Badge variant="outline" className="mt-3">
          {t('manufacturing.overviewPage.cards.labor.badge')}
        </Badge>
      </div>
    </div>
  )
}

