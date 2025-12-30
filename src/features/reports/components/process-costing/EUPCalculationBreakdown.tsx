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

// Helper functions to reduce complexity
function buildStageCostsQuery(filters: DashboardFilters) {
  if (!supabase) throw new Error('Supabase client not initialized')
  
  let query = supabase.from('stage_costs').select('*')
  
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
    query = query.eq('stage_no', filters.stageNo)
  }
  
  return query
}

async function fetchWorkCenters(wcIds: string[]) {
  if (wcIds.length === 0) return {}
  
  const { data: wcs, error: wcError } = await supabase
    .from('work_centers')
    .select('id, name, name_ar')
    .in('id', wcIds)
  
  if (wcError || !wcs) return {}
  
  const wcData: Record<string, { id: string; name?: string; name_ar?: string }> = {}
  wcs.forEach((wc: { id: string; name?: string; name_ar?: string }) => {
    wcData[wc.id] = wc
  })
  
  return wcData
}

async function fetchManufacturingOrders(moIds: string[], costingMethod?: string) {
  if (moIds.length === 0) return {}
  
  let moQuery = supabase
    .from('manufacturing_orders')
    .select('id, order_number, costing_method')
    .in('id', moIds)
  
  if (costingMethod && costingMethod !== 'all') {
    moQuery = moQuery.eq('costing_method', costingMethod)
  }
  
  const { data: mos, error: moError } = await moQuery
  
  if (moError || !mos) return {}
  
  const moData: Record<string, { id: string; order_number?: string; costing_method?: string }> = {}
  mos.forEach((mo: { id: string; order_number?: string; costing_method?: string }) => {
    moData[mo.id] = mo
  })
  
  return moData
}

function calculateEUP(
  record: Record<string, unknown>,
  costingMethod: string,
  stageNo: number
): { eupDm: number; eupCc: number } {
  const goodQty = Number(record.good_qty) || 0
  const wipEndQty = Number(record.wip_end_qty) || 0
  const wipEndDmPct = Number(record.wip_end_dm_completion_pct) || 0
  const wipEndCcPct = Number(record.wip_end_cc_completion_pct) || 0
  const wipBegQty = Number(record.wip_beginning_qty) || 0
  const wipBegDmPct = Number(record.wip_beginning_dm_completion_pct) || 0
  const wipBegCcPct = Number(record.wip_beginning_cc_completion_pct) || 0
  
  let eupDm = 0
  let eupCc = 0
  
  if (costingMethod === 'fifo') {
    if (stageNo === 1) {
      eupDm = goodQty + (wipEndQty * wipEndDmPct / 100) - (wipBegQty * wipBegDmPct / 100)
    } else {
      eupDm = goodQty
    }
    eupCc = goodQty + (wipEndQty * wipEndCcPct / 100) - (wipBegQty * wipBegCcPct / 100)
  } else {
    if (stageNo === 1) {
      eupDm = goodQty + (wipEndQty * wipEndDmPct / 100)
    } else {
      eupDm = goodQty
    }
    eupCc = goodQty + (wipEndQty * wipEndCcPct / 100)
  }
  
  return { eupDm, eupCc }
}

function transformToEUPData(
  record: Record<string, unknown>,
  moData: Record<string, { id: string; order_number?: string; costing_method?: string }>,
  wcData: Record<string, { id: string; name?: string; name_ar?: string }>,
  isRTL: boolean
): EUPData {
  const goodQty = Number(record.good_qty) || 0
  const wipEndQty = Number(record.wip_end_qty) || 0
  const wipEndDmPct = Number(record.wip_end_dm_completion_pct) || 0
  const wipEndCcPct = Number(record.wip_end_cc_completion_pct) || 0
  const wipBegQty = Number(record.wip_beginning_qty) || 0
  const wipBegDmPct = Number(record.wip_beginning_dm_completion_pct) || 0
  const wipBegCcPct = Number(record.wip_beginning_cc_completion_pct) || 0
  
  const moId = (record.manufacturing_order_id || record.mo_id) as string
  const mo = moData[moId]
  const costingMethod = mo?.costing_method || 'weighted_average'
  const stageNo = Number(record.stage_no) || Number(record.stage_number) || 0
  
  const { eupDm, eupCc } = calculateEUP(record, costingMethod, stageNo)
  
  const wcId = (record.wc_id || record.work_center_id) as string
  const wc = wcData[wcId]
  
  const stageName = isRTL
    ? (wc?.name_ar || wc?.name || `المرحلة ${stageNo}`)
    : (wc?.name || `Stage ${stageNo}`)
  
  return {
    stage_no: stageNo,
    stage_name: stageName,
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
    order_number: mo?.order_number || '',
    unit_cost: Number(record.unit_cost) || 0
  }
}

// eslint-disable-next-line complexity
export function EUPCalculationBreakdown({ filters }: { readonly filters: DashboardFilters }) {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  const { data: eupData, isLoading, error } = useQuery({
    queryKey: ['eup-calculation-breakdown', filters],
    queryFn: async () => {
      const query = buildStageCostsQuery(filters)
      const { data: stageCostsData, error: queryError } = await query
      
      if (stageCostsData && !queryError) {
        stageCostsData.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const aStage = Number(a.stage_no || a.stage_number || 0)
          const bStage = Number(b.stage_no || b.stage_number || 0)
          return aStage - bStage
        })
      }

      if (queryError) {
        // eslint-disable-next-line no-console
        console.error('❌ EUP Query Error:', queryError)
        
        const fallbackQuery = supabase.from('stage_costs').select('*').limit(100)
        if (filters.manufacturingOrderId) {
          fallbackQuery.eq('mo_id', filters.manufacturingOrderId)
        }
        
        const { data: fallbackData, error: fallbackError } = await fallbackQuery
        
        if (fallbackError) {
          throw new Error(`Failed to fetch EUP data: ${queryError.message}`)
        }
        
        if (!fallbackData || fallbackData.length === 0) {
          return []
        }
        
        return fallbackData.map((sc: Record<string, unknown>) => ({
          ...sc,
          manufacturing_orders: {},
          work_centers: {}
        }))
      }
      
      const wcIdArray = (stageCostsData || []).map((sc: { wc_id?: string }) => sc.wc_id).filter(Boolean);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const wcIds = [...new Set(wcIdArray)] as string[];
      const wcData = await fetchWorkCenters(wcIds);
      
      const moIdArray = (stageCostsData || []).map((sc: Record<string, unknown>) => sc.manufacturing_order_id || sc.mo_id).filter(Boolean);
      const moIds = [...new Set(moIdArray)] as string[];
      const moData = await fetchManufacturingOrders(moIds, filters.costingMethod)
      
      const filteredData = (stageCostsData || []).filter((sc: Record<string, unknown>) => {
        if (filters.costingMethod && filters.costingMethod !== 'all') {
          const moId = sc.manufacturing_order_id || sc.mo_id
          return moData[moId as string]?.costing_method === filters.costingMethod
        }
        return true
      })

      return filteredData.map((record: Record<string, unknown>) => 
        transformToEUPData(record, moData, wcData, isRTL)
      )
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

