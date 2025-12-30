/**
 * Stage-by-Stage Cost Breakdown Component
 * تفصيل التكاليف حسب المرحلة
 */

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Layers } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getGlassClasses } from '@/lib/wardah-ui-utils'

interface DashboardFilters {
  readonly manufacturingOrderId?: string
  readonly dateFrom?: string
  readonly dateTo?: string
  readonly stageNo?: number
  readonly costingMethod?: 'weighted_average' | 'fifo' | 'all'
}

interface StageCostRecord {
  readonly manufacturing_orders?: { readonly order_number?: string }
  readonly work_centers?: { readonly name?: string; readonly name_ar?: string }
  readonly stage_no: number
  readonly good_qty: number | string
  readonly dm_cost: number | string
  readonly dl_cost: number | string
  readonly moh_cost: number | string
  readonly total_cost: number | string
  readonly unit_cost: number | string
}

// NOSONAR - Complex report component required for stage cost breakdown
// eslint-disable-next-line complexity
export function StageCostBreakdown({ filters }: { readonly filters: DashboardFilters }) {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  // Helper function to get stage name
  const getStageName = (item: StageCostRecord): string => {
    if (isRTL) {
      return item.work_centers?.name_ar || item.work_centers?.name || `المرحلة ${item.stage_no}`
    }
    return item.work_centers?.name || `Stage ${item.stage_no}`
  }

  const { data: stageData, isLoading, error } = useQuery({
    queryKey: ['stage-cost-breakdown', filters],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')

      let query = supabase
        .from('stage_costs')
        .select('*')

      if (filters.manufacturingOrderId) {
        query = query.eq('mo_id', filters.manufacturingOrderId)
      }
      
      const { data: stageCostsData, error: queryError } = await query
      
      // Sort manually if order() fails
      if (stageCostsData && !queryError) {
        stageCostsData.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const aStage = Number(a.stage_no || a.stage_number || 0)
          const bStage = Number(b.stage_no || b.stage_number || 0)
          return aStage - bStage
        })
      }

      if (queryError) {
        console.error('❌ Stage Cost Breakdown Query Error:', queryError)
        
        // Try fallback
        const fallbackQuery = supabase
          .from('stage_costs')
          .select('*')
          .limit(100)
        
        // Don't add filter - fetch all and filter in memory
        const { data: fallbackData, error: fallbackError } = await fallbackQuery
        
        if (fallbackError) {
          throw new Error(`Failed to fetch stage costs: ${queryError.message}`)
        }
        
        // Filter by manufacturing_order_id or mo_id in memory
        const filtered = (fallbackData || []).filter((sc: Record<string, unknown>) => {
          if (!filters.manufacturingOrderId) return true
          return sc.manufacturing_order_id === filters.manufacturingOrderId || sc.mo_id === filters.manufacturingOrderId
        })
        
        return filtered.map((sc: Record<string, unknown>) => ({
          ...sc,
          manufacturing_orders: {},
          work_centers: {}
        })) as unknown as StageCostRecord[]
      }
      
      // Fetch work centers separately - support both column names
      const wcIds = [...new Set((stageCostsData || []).map((sc: Record<string, unknown>) => sc.wc_id || sc.work_center_id).filter(Boolean))]
      
      const wcData: Record<string, { id: string; name?: string; name_ar?: string }> = {}
      if (wcIds.length > 0) {
        const { data: wcs, error: wcError } = await supabase
          .from('work_centers')
          .select('id, name, name_ar')
          .in('id', wcIds)
        
        if (!wcError && wcs) {
          wcs.forEach((wc: { id: string; name?: string; name_ar?: string }) => {
            wcData[wc.id] = wc
          })
        }
      }
      
      // Fetch manufacturing orders separately - support both column names
      const moIds = [...new Set((stageCostsData || []).map((sc: Record<string, unknown>) => sc.manufacturing_order_id || sc.mo_id).filter(Boolean))]
      
      const moData: Record<string, { id: string; order_number?: string }> = {}
      if (moIds.length > 0) {
        const { data: mos, error: moError } = await supabase
          .from('manufacturing_orders')
          .select('id, order_number')
          .in('id', moIds)
        
        if (!moError && mos) {
          mos.forEach((mo: { id: string; order_number?: string }) => {
            moData[mo.id] = mo
          })
        }
      }
      
      // Join data - support both column names
      return (stageCostsData || []).map((sc: Record<string, unknown>) => ({
        ...sc,
        manufacturing_orders: moData[(sc.manufacturing_order_id || sc.mo_id) as string],
        work_centers: wcData[(sc.wc_id || sc.work_center_id) as string]
      })) as unknown as StageCostRecord[]
    }
  })

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <Layers className="h-8 w-8 animate-pulse mx-auto text-primary" />
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
            <Layers className="h-5 w-5" />
            {isRTL ? 'تفصيل التكاليف حسب المرحلة' : 'Stage-by-Stage Cost Breakdown'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(isRTL && "text-right")}>{isRTL ? 'أمر التصنيع' : 'MO'}</TableHead>
                  <TableHead className={cn(isRTL && "text-right")}>{isRTL ? 'المرحلة' : 'Stage'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'الكمية الجيدة' : 'Good Qty'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'المواد المباشرة' : 'DM Cost'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'العمالة المباشرة' : 'DL Cost'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'الأوفرهيد' : 'OH Cost'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'إجمالي التكلفة' : 'Total Cost'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'تكلفة الوحدة' : 'Unit Cost'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageData?.map((item: StageCostRecord) => (
                  <TableRow key={`${item.manufacturing_orders?.order_number || ''}-${item.stage_no}`}>
                    <TableCell>{item.manufacturing_orders?.order_number}</TableCell>
                    <TableCell>{getStageName(item)}</TableCell>
                    <TableCell className="text-right font-mono">{Number(item.good_qty || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right font-mono">{Number(item.dm_cost || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                    <TableCell className="text-right font-mono">{Number(item.dl_cost || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                    <TableCell className="text-right font-mono">{Number(item.moh_cost || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                    <TableCell className="text-right font-mono font-bold">{Number(item.total_cost || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                    <TableCell className="text-right font-mono font-bold text-primary">{Number(item.unit_cost || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

