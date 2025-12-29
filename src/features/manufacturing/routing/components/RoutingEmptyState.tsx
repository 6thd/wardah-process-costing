/**
 * Routing Empty State Component
 * مكون حالة فارغة للمسارات
 */

import React from 'react'
import { Button } from '@/components/ui/button'
import { Route, Plus } from 'lucide-react'

interface RoutingEmptyStateProps {
  isRTL: boolean
  onCreateNew: () => void
}

export const RoutingEmptyState: React.FC<RoutingEmptyStateProps> = ({
  isRTL,
  onCreateNew
}) => {
  return (
    <div className="text-center py-12">
      <Route className="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 className="mt-2 text-lg font-medium">{isRTL ? 'لا توجد مسارات' : 'No routings found'}</h3>
      <p className="mt-1 text-muted-foreground">
        {isRTL ? 'ابدأ بإنشاء مسار تصنيع جديد' : 'Start by creating a new routing'}
      </p>
      <Button className="mt-4" onClick={onCreateNew}>
        <Plus className="w-4 h-4 mr-2" />
        {isRTL ? 'إنشاء مسار جديد' : 'Create New Routing'}
      </Button>
    </div>
  )
}

