/**
 * WIP Valuation Report Component
 * تقرير تقييم العمل قيد التنفيذ
 */

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Factory, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getGlassClasses } from '@/lib/wardah-ui-utils'

interface DashboardFilters {
  manufacturingOrderId?: string
  dateFrom?: string
  dateTo?: string
  stageNo?: number
  costingMethod?: 'weighted_average' | 'fifo' | 'all'
}

export function WIPValuationReport({ filters }: { readonly filters: DashboardFilters }) {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  const { data: wipData, isLoading, error } = useQuery({
    queryKey: ['wip-valuation-report', filters],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')

      let query = supabase
        .from('stage_costs')
        .select('*')

      if (filters.manufacturingOrderId) {
        query = query.eq('manufacturing_order_id', filters.manufacturingOrderId)
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
        console.error('❌ WIP Valuation Query Error:', queryError)
        
        // Try fallback
        const fallbackQuery = supabase
          .from('stage_costs')
          .select('*')
          .limit(100)
        
        // Don't add filter - fetch all and filter in memory
        const { data: fallbackData, error: fallbackError } = await fallbackQuery
        
        if (fallbackError) {
          throw new Error(`Failed to fetch WIP data: ${queryError.message}`)
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
        }))
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
      
      const moData: Record<string, { order_number?: string }> = {}
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
      }))
    }
  })

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <Factory className="h-8 w-8 animate-pulse mx-auto text-primary" />
        <p className="text-muted-foreground">{isRTL ? 'جارٍ تحميل البيانات...' : 'Loading data...'}</p>
      </div>
    </div>
  }

  if (error) {
    return <Alert variant="destructive" className={getGlassClasses()}>
      <AlertDescription>{isRTL ? 'حدث خطأ' : 'Error'}: {error.message}</AlertDescription>
    </Alert>
  }

  const wipRecords = (wipData || []).map((item: any) => {
    const wipEndQty = Number(item.wip_end_qty) || 0
    const unitCost = Number(item.unit_cost) || 0
    const wipValue = wipEndQty * unitCost
    
    return {
      order_number: item.manufacturing_orders?.order_number || '',
      stage_name: isRTL ? (item.work_centers?.name_ar || item.work_centers?.name || `المرحلة ${item.stage_no}`) : (item.work_centers?.name || `Stage ${item.stage_no}`),
      wip_end_qty: wipEndQty,
      wip_end_dm_pct: Number(item.wip_end_dm_completion_pct) || 0,
      wip_end_cc_pct: Number(item.wip_end_cc_completion_pct) || 0,
      unit_cost: unitCost,
      wip_value: wipValue
    }
  }).filter((item: any) => item.wip_end_qty > 0)

  const totalWipValue = wipRecords.reduce((sum: number, item: any) => sum + item.wip_value, 0)

  return (
    <div className="space-y-6">
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
            <Factory className="h-5 w-5" />
            {isRTL ? 'تقرير تقييم WIP' : 'WIP Valuation Report'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wipRecords.length > 0 ? (
            <>
              <div className="mb-6 p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-center">
                  {isRTL ? 'إجمالي قيمة WIP' : 'Total WIP Value'}: {totalWipValue.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={cn(isRTL && "text-right")}>{isRTL ? 'أمر التصنيع' : 'MO'}</TableHead>
                      <TableHead className={cn(isRTL && "text-right")}>{isRTL ? 'المرحلة' : 'Stage'}</TableHead>
                      <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'كمية WIP النهاية' : 'End WIP Qty'}</TableHead>
                      <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? '% إتمام المواد' : 'DM %'}</TableHead>
                      <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? '% إتمام التحويل' : 'CC %'}</TableHead>
                      <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'تكلفة الوحدة' : 'Unit Cost'}</TableHead>
                      <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'قيمة WIP' : 'WIP Value'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wipRecords.map((item: any) => (
                      <TableRow key={`${item.order_number || ''}-${item.stage_name || ''}-${item.wip_end_qty || 0}`}>
                        <TableCell>{item.order_number}</TableCell>
                        <TableCell>{item.stage_name}</TableCell>
                        <TableCell className="text-right font-mono">{item.wip_end_qty.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-mono">{item.wip_end_dm_pct.toFixed(1)}%</TableCell>
                        <TableCell className="text-right font-mono">{item.wip_end_cc_pct.toFixed(1)}%</TableCell>
                        <TableCell className="text-right font-mono">{item.unit_cost.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                        <TableCell className="text-right font-mono font-bold">{item.wip_value.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className={cn(isRTL && "text-right")}>
                {isRTL ? 'لا توجد WIP حالياً' : 'No WIP currently'}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

