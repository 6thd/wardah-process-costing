/**
 * Recent Orders Component
 * مكون الأوامر الأخيرة
 */

import React from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ManufacturingOrder } from '@/lib/supabase'

interface RecentOrdersProps {
  orders: ManufacturingOrder[]
  loading: boolean
  isRTL: boolean
  t: (key: string) => string
}

export const RecentOrders: React.FC<RecentOrdersProps> = ({
  orders,
  loading,
  isRTL,
  t
}) => {
  if (loading) {
    return null
  }

  const getStatusBadge = (status: string) => {
    if (status === 'completed') {
      return 'default'
    }
    if (status === 'in-progress') {
      return 'secondary'
    }
    return 'outline'
  }

  const getStatusText = (status: string) => {
    if (status === 'completed') {
      return t('manufacturing.overviewPage.latestOrders.status.completed')
    }
    if (status === 'in-progress') {
      return t('manufacturing.overviewPage.latestOrders.status.inProgress')
    }
    return t('manufacturing.overviewPage.latestOrders.status.pending')
  }

  return (
    <div className="wardah-glass-card">
      <div className="p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold wardah-text-gradient-google">
          {t('manufacturing.overviewPage.latestOrders.title')}
        </h3>
        <Link to="/manufacturing/orders">
          <Button variant="outline" size="sm">
            {t('manufacturing.overviewPage.latestOrders.viewAll')}
          </Button>
        </Link>
      </div>
      <div className="divide-y">
        {orders.slice(0, 5).map((order) => (
          <div key={order.id} className="p-4 flex justify-between items-center">
            <div>
              <h4 className="font-medium">{order.order_number}</h4>
              <p className="text-sm text-muted-foreground">{order.product_name}</p>
            </div>
            <div className="text-right flex items-center gap-2">
              <Badge variant={getStatusBadge(order.status)}>
                {getStatusText(order.status)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {t('manufacturing.overviewPage.latestOrders.unitsLabel').replace('{count}', order.quantity.toString())}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

