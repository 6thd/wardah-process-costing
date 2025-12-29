/**
 * EUP Calculation Breakdown Component
 * مكون تفصيل حساب الوحدات المكافئة (Equivalent Units of Production)
 */

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Calculator, Info, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getGlassClasses } from '@/lib/wardah-ui-utils'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts'

interface DashboardFilters {
  manufacturingOrderId?: string
  dateFrom?: string
  dateTo?: string
  stageNo?: number
  costingMethod?: 'weighted_average' | 'fifo' | 'all'
}

interface EUPData {
  stage_no: number
  stage_name: string
  good_qty: number
  wip_end_qty: number
  wip_end_dm_completion_pct: number
  wip_end_cc_completion_pct: number
  wip_beginning_qty: number
  wip_beginning_dm_completion_pct: number
  wip_beginning_cc_completion_pct: number
  eup_dm: number
  eup_cc: number
  costing_method: string
  order_number: string
  unit_cost: number
}

export function EUPCalculationBreakdown({ filters }: { readonly filters: DashboardFilters }) {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  const { data: eupData, isLoading, error } = useQuery({
    queryKey: ['eup-calculation-breakdown', filters],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')

      // Build query - use select('*') to avoid column name issues
      // Try stage_no first, fallback to stage_number if needed
      let query = supabase
        .from('stage_costs')
        .select('*')

      // Apply filters - try manufacturing_order_id first (actual column name)
      if (filters.manufacturingOrderId) {
        query = query.eq('manufacturing_order_id', filters.manufacturingOrderId)
      }

      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom)
      }

      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo)
      }

      if (filters.stageNo) {
        // Try stage_no first, fallback to stage_number
        query = query.eq('stage_no', filters.stageNo)
      }
      
      // Order by stage_no or stage_number (handle dynamically after query)
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
        console.error('❌ EUP Query Error:', {
          message: queryError.message,
          code: queryError.code,
          details: queryError.details,
          hint: queryError.hint
        })
        
        // Try fallback: simple select all
        const fallbackQuery = supabase
          .from('stage_costs')
          .select('*')
          .limit(100)
        
        if (filters.manufacturingOrderId) {
          fallbackQuery.eq('mo_id', filters.manufacturingOrderId)
        }
        
        const { data: fallbackData, error: fallbackError } = await fallbackQuery
        
        if (fallbackError) {
          console.error('❌ Fallback query also failed:', fallbackError)
          throw new Error(`Failed to fetch EUP data: ${queryError.message}`)
        }
        
        // Return empty array if fallback succeeds but no data
        if (!fallbackData || fallbackData.length === 0) {
          return []
        }
        
        // Use fallback data (will be processed below)
        const processedData = fallbackData.map((sc: Record<string, unknown>) => ({
          ...sc,
          manufacturing_orders: {},
          work_centers: {}
        }))
        
        return processedData
      }
      
      // Fetch work centers separately
      const wcIds = [...new Set((stageCostsData || []).map((sc: { wc_id?: string }) => sc.wc_id).filter(Boolean))]
      
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
      const data = (stageCostsData || []).filter((sc: Record<string, unknown>) => {
        if (filters.costingMethod && filters.costingMethod !== 'all') {
          const moId = sc.manufacturing_order_id || sc.mo_id
          return moData[moId as string]?.costing_method === filters.costingMethod
        }
        return true
      }).map((sc: Record<string, unknown>) => ({
        ...sc,
        manufacturing_orders: moData[(sc.manufacturing_order_id || sc.mo_id) as string],
        work_centers: wcData[(sc.wc_id || sc.work_center_id) as string]
      }))

      // Calculate EUP for each record
      return (data || []).map((record: Record<string, unknown>) => {
        const goodQty = Number(record.good_qty) || 0
        const wipEndQty = Number(record.wip_end_qty) || 0
        const wipEndDmPct = Number(record.wip_end_dm_completion_pct) || 0
        const wipEndCcPct = Number(record.wip_end_cc_completion_pct) || 0
        const wipBegQty = Number(record.wip_beginning_qty) || 0
        const wipBegDmPct = Number(record.wip_beginning_dm_completion_pct) || 0
        const wipBegCcPct = Number(record.wip_beginning_cc_completion_pct) || 0
        
        // Get costing method from manufacturing_orders
        const moData = record.manufacturing_orders as Record<string, unknown> | undefined
        const costingMethod = (moData?.costing_method as string) || 'weighted_average'

        // Calculate EUP based on costing method
        let eupDm = 0
        let eupCc = 0

        const stageNo = Number(record.stage_no) || Number(record.stage_number) || 0
        
        if (costingMethod === 'fifo') {
          // FIFO: EUP = good_qty + ending_wip - beginning_wip
          if (stageNo === 1) {
            eupDm = goodQty + (wipEndQty * wipEndDmPct / 100) - (wipBegQty * wipBegDmPct / 100)
          } else {
            eupDm = goodQty // Stages > 1: DM already in transferred-in
          }
          eupCc = goodQty + (wipEndQty * wipEndCcPct / 100) - (wipBegQty * wipBegCcPct / 100)
        } else {
          // Weighted-Average: EUP = good_qty + ending_wip
          if (stageNo === 1) {
            eupDm = goodQty + (wipEndQty * wipEndDmPct / 100)
          } else {
            eupDm = goodQty
          }
          eupCc = goodQty + (wipEndQty * wipEndCcPct / 100)
        }

        // Get work center data
        const wcData = record.work_centers as Record<string, unknown> | undefined
        
        return {
          stage_no: stageNo,
          stage_name: (() => {
            if (isRTL) {
              return (wcData?.name_ar as string) || (wcData?.name as string) || `المرحلة ${stageNo}`
            }
            return (wcData?.name as string) || `Stage ${stageNo}`
          })(),
          good_qty: goodQty,
          wip_end_qty: wipEndQty,
          wip_end_dm_completion_pct: wipEndDmPct,
          wip_end_cc_completion_pct: wipEndCcPct,
          wip_beginning_qty: wipBegQty,
          wip_beginning_dm_completion_pct: wipBegDmPct,
          wip_beginning_cc_completion_pct: wipBegCcPct,
          eup_dm: eupDm,
          eup_cc: eupCc,
          costing_method: costingMethod,
          order_number: (moData?.order_number as string) || '',
          unit_cost: Number(record.unit_cost) || 0
        } as EUPData
      })
    }
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Calculator className="h-8 w-8 animate-pulse mx-auto text-primary" />
          <p className="text-muted-foreground">{isRTL ? 'جارٍ تحميل البيانات...' : 'Loading data...'}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive" className={getGlassClasses()}>
        <AlertDescription>
          {isRTL ? 'حدث خطأ أثناء تحميل البيانات' : 'Error loading data'}: {error.message}
        </AlertDescription>
      </Alert>
    )
  }

  if (!eupData || eupData.length === 0) {
    return (
      <Alert className={getGlassClasses()}>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {isRTL ? 'لا توجد بيانات لعرضها' : 'No data available'}
        </AlertDescription>
      </Alert>
    )
  }

  // Prepare chart data
  const chartData = eupData.map(item => ({
    stage: item.stage_name,
    goodQty: item.good_qty,
    eupDm: item.eup_dm,
    eupCc: item.eup_cc,
    wipEnd: item.wip_end_qty,
    wipBeg: item.wip_beginning_qty
  }))

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
            <Info className="h-5 w-5" />
            {isRTL ? 'معلومات عن حساب EUP' : 'About EUP Calculation'}
          </CardTitle>
        </CardHeader>
        <CardContent className={cn("space-y-2 text-sm", isRTL ? "text-right" : "text-left")}>
          <p>
            <strong>{isRTL ? 'الوحدات المكافئة (EUP)' : 'Equivalent Units of Production (EUP)'}</strong>:
            {isRTL 
              ? ' هي طريقة لحساب الوحدات المكتملة مع الأخذ في الاعتبار العمل قيد التنفيذ (WIP).'
              : ' is a method to calculate completed units considering Work-In-Process (WIP).'
            }
          </p>
          <div className="space-y-1 mt-4">
            <p><strong>{isRTL ? 'طريقة المتوسط المرجح:' : 'Weighted-Average Method:'}</strong></p>
            <p className="text-muted-foreground font-mono text-xs">
              EUP = Good Qty + (Ending WIP × Completion %)
            </p>
            <p className="mt-2"><strong>{isRTL ? 'طريقة FIFO:' : 'FIFO Method:'}</strong></p>
            <p className="text-muted-foreground font-mono text-xs">
              EUP = Good Qty + (Ending WIP × Completion %) - (Beginning WIP × Completion %)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* EUP Table */}
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
            <Calculator className="h-5 w-5" />
            {isRTL ? 'تفصيل حساب EUP' : 'EUP Calculation Breakdown'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(isRTL && "text-right")}>{isRTL ? 'أمر التصنيع' : 'MO'}</TableHead>
                  <TableHead className={cn(isRTL && "text-right")}>{isRTL ? 'المرحلة' : 'Stage'}</TableHead>
                  <TableHead className={cn(isRTL && "text-right")}>{isRTL ? 'الطريقة' : 'Method'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'الكمية الجيدة' : 'Good Qty'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'WIP البداية' : 'Beg WIP'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'WIP النهاية' : 'End WIP'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'EUP (مواد)' : 'EUP (DM)'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'EUP (تحويل)' : 'EUP (CC)'}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{isRTL ? 'تكلفة الوحدة' : 'Unit Cost'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eupData.map((item) => (
                  <TableRow key={`eup-${item.stage_no}-${item.order_number}`}>
                    <TableCell>{item.order_number}</TableCell>
                    <TableCell>{item.stage_name}</TableCell>
                    <TableCell>
                      <Badge variant={item.costing_method === 'fifo' ? 'default' : 'secondary'}>
                        {item.costing_method === 'fifo' ? 'FIFO' : 'Weighted-Avg'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {item.good_qty.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {item.wip_beginning_qty > 0 ? (
                        <>
                          {item.wip_beginning_qty.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span className="text-xs text-muted-foreground block">
                            ({item.wip_beginning_dm_completion_pct.toFixed(1)}% / {item.wip_beginning_cc_completion_pct.toFixed(1)}%)
                          </span>
                        </>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {item.wip_end_qty > 0 ? (
                        <>
                          {item.wip_end_qty.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span className="text-xs text-muted-foreground block">
                            ({item.wip_end_dm_completion_pct.toFixed(1)}% / {item.wip_end_cc_completion_pct.toFixed(1)}%)
                          </span>
                        </>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {item.eup_dm.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-primary">
                      {item.eup_cc.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      {item.unit_cost.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* EUP Comparison Chart */}
        <Card className={getGlassClasses()}>
          <CardHeader>
            <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
              <TrendingUp className="h-5 w-5" />
              {isRTL ? 'مقارنة EUP (مواد مقابل تحويل)' : 'EUP Comparison (DM vs CC)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="eupDm" name={isRTL ? 'EUP (مواد)' : 'EUP (DM)'} fill="#8884d8" />
                <Bar dataKey="eupCc" name={isRTL ? 'EUP (تحويل)' : 'EUP (CC)'} fill="#82ca9d" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* WIP Flow Chart */}
        <Card className={getGlassClasses()}>
          <CardHeader>
            <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
              <TrendingUp className="h-5 w-5" />
              {isRTL ? 'تدفق WIP' : 'WIP Flow'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="wipBeg" name={isRTL ? 'WIP البداية' : 'Beg WIP'} stroke="#8884d8" />
                <Line type="monotone" dataKey="wipEnd" name={isRTL ? 'WIP النهاية' : 'End WIP'} stroke="#82ca9d" />
                <Line type="monotone" dataKey="goodQty" name={isRTL ? 'الكمية الجيدة' : 'Good Qty'} stroke="#ffc658" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

