/**
 * Work Orders Empty State Component
 * مكون حالة فارغة لأوامر العمل
 */

import React from 'react'
import { Factory } from 'lucide-react'

interface WorkOrdersEmptyStateProps {
  isRTL: boolean
}

export const WorkOrdersEmptyState: React.FC<WorkOrdersEmptyStateProps> = ({
  isRTL
}) => {
  return (
    <div className="text-center py-12">
      <Factory className="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 className="mt-2 text-lg font-medium">{isRTL ? 'لا توجد أوامر عمل' : 'No Work Orders'}</h3>
      <p className="mt-1 text-muted-foreground">
        {isRTL ? 'لا توجد أوامر عمل نشطة لمركز العمل هذا' : 'No active work orders for this work center'}
      </p>
    </div>
  )
}

