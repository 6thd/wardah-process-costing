/**
 * Manufacturing Metrics Component
 * مكون مقاييس التصنيع
 */

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ManufacturingOrder } from '@/lib/supabase'
import type { ManufacturingOrderStatus } from '@/utils/manufacturing-order-status'
import { isActiveOrder, isCompletedOrder, isPendingOrder } from '@/utils/manufacturing-order-status'

interface ManufacturingMetricsProps {
  orders: ManufacturingOrder[]
  isRTL: boolean
  t: (key: string) => string
}

export const ManufacturingMetrics: React.FC<ManufacturingMetricsProps> = ({
  orders,
  isRTL,
  t
}) => {
  const activeOrders = orders.filter(order => isActiveOrder(order.status as ManufacturingOrderStatus))
  const completedOrders = orders.filter(order => isCompletedOrder(order.status as ManufacturingOrderStatus))
  const pendingOrders = orders.filter(order => isPendingOrder(order.status as ManufacturingOrderStatus))

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
        <div className="text-2xl font-bold text-blue-600">{activeOrders.length}</div>
        <div className="text-sm text-muted-foreground">{t('manufacturing.overviewPage.metrics.active')}</div>
      </div>
      <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
        <div className="text-2xl font-bold text-green-600">{completedOrders.length}</div>
        <div className="text-sm text-muted-foreground">{t('manufacturing.overviewPage.metrics.completed')}</div>
      </div>
      <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
        <div className="text-2xl font-bold text-amber-600">{pendingOrders.length}</div>
        <div className="text-sm text-muted-foreground">{t('manufacturing.overviewPage.metrics.pending')}</div>
      </div>
      <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
        <div className="text-2xl font-bold text-purple-600">85.6%</div>
        <div className="text-sm text-muted-foreground">{t('manufacturing.overviewPage.metrics.efficiency')}</div>
      </div>
    </div>
  )
}

