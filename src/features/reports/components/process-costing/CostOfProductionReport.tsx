/**
 * Cost of Production Report Component
 * تقرير تكلفة الإنتاج
 */

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getGlassClasses } from '@/lib/wardah-ui-utils'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface DashboardFilters {
  readonly manufacturingOrderId?: string
  readonly dateFrom?: string
  readonly dateTo?: string
  readonly stageNo?: number
  readonly costingMethod?: 'weighted_average' | 'fifo' | 'all'
}

export function CostOfProductionReport({ filters }: { readonly filters: DashboardFilters }) {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  const { data, isLoading, error } = useQuery({
    queryKey: ['cost-of-production-report', filters],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      
      // Use select('*') - RLS will handle filtering
      let query = supabase
        .from('stage_costs')
        .select('*')

      if (filters.manufacturingOrderId) {
        query = query.eq('manufacturing_order_id', filters.manufacturingOrderId)
      }

      const { data: stageCostsData, error: queryError } = await query
      if (queryError) throw queryError
      
      // Fetch manufacturing orders separately if needed - support both column names
      const moIds = [...new Set((stageCostsData || []).map((sc: Record<string, unknown>) => sc.manufacturing_order_id || sc.mo_id).filter(Boolean))]
      
      const moData: Record<string, { id: string; order_number?: string; costing_method?: string }> = {}
      if (moIds.length > 0) {
        let moQuery = supabase
          .from('manufacturing_orders')
          .select('id, order_number, costing_method')
          .in('id', moIds)
        
        if (filters.costingMethod && filters.costingMethod !== 'all') {
          moQuery = moQuery.eq('costing_method', filters.costingMethod)
        }
        
        const { data: mos, error: moError } = await moQuery
        
        if (!moError && mos) {
          mos.forEach((mo: { id: string; order_number?: string; costing_method?: string }) => {
            moData[mo.id] = mo
          })
        }
      }
      
      // Filter and join data - support both column names
      return (stageCostsData || []).filter((sc: Record<string, unknown>) => {
        if (filters.costingMethod && filters.costingMethod !== 'all') {
          const moId = sc.manufacturing_order_id || sc.mo_id
          return moData[moId as string]?.costing_method === filters.costingMethod
        }
        return true
      }).map((sc: Record<string, unknown>) => ({
        ...sc,
        manufacturing_orders: moData[(sc.manufacturing_order_id || sc.mo_id) as string]
      }))
    }
  })

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <BarChart3 className="h-8 w-8 animate-pulse mx-auto text-primary" />
        <p className="text-muted-foreground">{isRTL ? 'جارٍ تحميل البيانات...' : 'Loading data...'}</p>
      </div>
    </div>
  }

  if (error) {
    return <Alert variant="destructive" className={getGlassClasses()}>
      <AlertDescription>{isRTL ? 'حدث خطأ' : 'Error'}: {error.message}</AlertDescription>
    </Alert>
  }

  const totals = (data || []).reduce((acc: any, item: any) => ({
    totalCost: acc.totalCost + (Number(item.total_cost) || 0),
    goodQty: acc.goodQty + (Number(item.good_qty) || 0),
    dmCost: acc.dmCost + (Number(item.dm_cost) || 0),
    dlCost: acc.dlCost + (Number(item.dl_cost) || 0),
    mohCost: acc.mohCost + (Number(item.moh_cost) || 0)
  }), { totalCost: 0, goodQty: 0, dmCost: 0, dlCost: 0, mohCost: 0 })

  return (
    <div className="space-y-6">
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
            <BarChart3 className="h-5 w-5" />
            {isRTL ? 'تقرير تكلفة الإنتاج' : 'Cost of Production Report'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{isRTL ? 'إجمالي التكلفة' : 'Total Cost'}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totals.totalCost.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{isRTL ? 'الكمية الجيدة' : 'Good Quantity'}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totals.goodQty.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{isRTL ? 'متوسط التكلفة للوحدة' : 'Avg Unit Cost'}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totals.goodQty > 0 ? (totals.totalCost / totals.goodQty).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 0} ر.س
                </div>
              </CardContent>
            </Card>
          </div>
          
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className={cn(isRTL && "text-right")}>
              {isRTL 
                ? 'هذا التقرير يعرض نظرة عامة على تكلفة الإنتاج. استخدم التبويبات الأخرى للحصول على تفاصيل أكثر.'
                : 'This report provides an overview of production costs. Use other tabs for more details.'
              }
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}

