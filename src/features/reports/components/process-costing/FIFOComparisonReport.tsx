/**
 * FIFO vs Weighted-Average Comparison Report
 * مقارنة بين طريقة FIFO والمتوسط المرجح
 */

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowUpDown, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getGlassClasses } from '@/lib/wardah-ui-utils'

interface DashboardFilters {
  readonly manufacturingOrderId?: string
  readonly dateFrom?: string
  readonly dateTo?: string
  readonly stageNo?: number
  readonly costingMethod?: 'weighted_average' | 'fifo' | 'all'
}

export function FIFOComparisonReport({ filters }: { readonly filters: DashboardFilters }) {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  const { isLoading, error } = useQuery({
    queryKey: ['fifo-comparison-report', filters],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      // This query will be implemented when comparison data is needed
      // For now, return empty array to avoid errors
      return []
    },
    enabled: false // Disabled until implementation is complete
  })

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <ArrowUpDown className="h-8 w-8 animate-pulse mx-auto text-primary" />
        <p className="text-muted-foreground">{isRTL ? 'جارٍ تحميل البيانات...' : 'Loading data...'}</p>
      </div>
    </div>
  }

  if (error) {
    return <Alert variant="destructive" className={getGlassClasses()}>
      <AlertDescription>{isRTL ? 'حدث خطأ' : 'Error'}: {error.message}</AlertDescription>
    </Alert>
  }

  return (
    <div className="space-y-6">
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
            <ArrowUpDown className="h-5 w-5" />
            {isRTL ? 'مقارنة FIFO مقابل المتوسط المرجح' : 'FIFO vs Weighted-Average Comparison'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <Info className="h-4 w-4" />
            <AlertDescription className={cn(isRTL && "text-right")}>
              {isRTL 
                ? 'هذه المقارنة تعرض الفروقات بين طريقة FIFO والمتوسط المرجح في حساب تكلفة الوحدة.'
                : 'This comparison shows the differences between FIFO and Weighted-Average methods in unit cost calculation.'
              }
            </AlertDescription>
          </Alert>
          
          <div className="text-center py-8 text-muted-foreground">
            {isRTL ? 'قيد التطوير - سيتم إضافة المقارنة التفصيلية قريباً' : 'Under Development - Detailed comparison coming soon'}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

