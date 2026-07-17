/**
 * Scrap Analysis Report Component
 * مكون تحليل الهالك (Normal vs Abnormal Scrap)
 */

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Scissors, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getGlassClasses } from '@/lib/wardah-ui-utils'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts'

interface DashboardFilters {
  manufacturingOrderId?: string
  dateFrom?: string
  dateTo?: string
  stageNo?: number
  costingMethod?: 'weighted_average' | 'fifo' | 'all'
}

interface ScrapData {
  stage_no: number
  stage_name: string
  good_qty: number
  scrap_qty: number
  normal_scrap_qty: number
  abnormal_scrap_qty: number
  normal_scrap_cost: number
  abnormal_scrap_cost: number
  regrind_cost: number
  waste_credit_amount: number
  normal_scrap_rate: number
  order_number: string
  unit_cost: number
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042']

// Helper functions to reduce cognitive complexity
const buildStageCostsQuery = (filters: DashboardFilters) => {
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
    query = query.eq('stage_number', filters.stageNo)
  }

  return query
}

const sortStageCostsData = (data: Record<string, unknown>[] | null) => {
  if (!data) return
  data.sort((a, b) => {
    const aStage = Number(a.stage_no || a.stage_number || 0)
    const bStage = Number(b.stage_no || b.stage_number || 0)
    return aStage - bStage
  })
}

const processFallbackData = async (filters: DashboardFilters): Promise<ScrapData[]> => {
  if (!supabase) throw new Error('Supabase client not initialized')

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('stage_costs')
    .select('*')
    .limit(100)

  if (fallbackError) {
    throw new Error(`Failed to fetch scrap data: ${fallbackError.message}`)
  }

  const filtered = (fallbackData || []).filter((sc: Record<string, unknown>) => {
    if (!filters.manufacturingOrderId) return true
    return sc.manufacturing_order_id === filters.manufacturingOrderId || sc.mo_id === filters.manufacturingOrderId
  })

  if (filtered.length === 0) {
    return []
  }

  return filtered.map((sc: Record<string, unknown>) => ({
    stage_no: Number(sc.stage_no || sc.stage_number || 0),
    stage_name: i18next.t('scrap.stageLabel', { no: sc.stage_no || sc.stage_number || 0 }),
    good_qty: Number(sc.good_qty) || 0,
    scrap_qty: Number(sc.scrap_qty) || 0,
    normal_scrap_qty: Number(sc.normal_scrap_qty) || 0,
    abnormal_scrap_qty: Number(sc.abnormal_scrap_qty) || 0,
    normal_scrap_cost: Number(sc.normal_scrap_cost) || 0,
    abnormal_scrap_cost: Number(sc.abnormal_scrap_cost) || 0,
    regrind_cost: Number(sc.regrind_cost) || 0,
    waste_credit_amount: Number(sc.waste_credit_amount) || 0,
    normal_scrap_rate: 0,
    order_number: '',
    unit_cost: Number(sc.unit_cost) || 0
  }))
}

const fetchWorkCenters = async (wcIds: string[]) => {
  if (!supabase || wcIds.length === 0) return {}

  const { data: wcs, error: wcError } = await supabase
    .from('work_centers')
    .select('id, name, name_ar, normal_scrap_rate')
    .in('id', wcIds)

  if (wcError || !wcs) return {}

  const wcData: Record<string, { id: string; name?: string; name_ar?: string; normal_scrap_rate?: number }> = {}
  wcs.forEach((wc) => {
    wcData[wc.id] = wc
  })

  return wcData
}

const fetchManufacturingOrders = async (moIds: string[]) => {
  if (!supabase || moIds.length === 0) return {}

  const { data: mos, error: moError } = await supabase
    .from('manufacturing_orders')
    .select('id, order_number')
    .in('id', moIds)

  if (moError || !mos) return {}

  const moData: Record<string, { id: string; order_number?: string }> = {}
  mos.forEach((mo) => {
    moData[mo.id] = mo
  })

  return moData
}

const transformToScrapData = (
  stageCostsData: Record<string, unknown>[],
  wcData: Record<string, { id: string; name?: string; name_ar?: string; normal_scrap_rate?: number }>,
  moData: Record<string, { id: string; order_number?: string }>,
  isRTL: boolean
): ScrapData[] => {
  return stageCostsData.map((sc: Record<string, unknown>) => {
    const stageNo = Number(sc.stage_no || sc.stage_number || 0)
    const wcId = (sc.wc_id || sc.work_center_id) as string
    const moId = (sc.manufacturing_order_id || sc.mo_id) as string
    const workCenters = wcData[wcId]
    const manufacturingOrders = moData[moId]

    return {
      stage_no: stageNo,
      stage_name: isRTL
        ? (workCenters?.name_ar || workCenters?.name || i18next.t('scrap.stageLabel', { no: stageNo }))
        : (workCenters?.name || i18next.t('scrap.stageLabel', { no: stageNo })),
      good_qty: Number(sc.good_qty) || 0,
      scrap_qty: Number(sc.scrap_qty) || 0,
      normal_scrap_qty: Number(sc.normal_scrap_qty) || 0,
      abnormal_scrap_qty: Number(sc.abnormal_scrap_qty) || 0,
      normal_scrap_cost: Number(sc.normal_scrap_cost) || 0,
      abnormal_scrap_cost: Number(sc.abnormal_scrap_cost) || 0,
      regrind_cost: Number(sc.regrind_cost) || 0,
      waste_credit_amount: Number(sc.waste_credit_amount) || 0,
      normal_scrap_rate: Number(workCenters?.normal_scrap_rate) || 0,
      order_number: manufacturingOrders?.order_number || '',
      unit_cost: Number(sc.unit_cost) || 0
    }
  })
}

// NOSONAR - Complex report component required for comprehensive scrap analysis
// NOSONAR - Complex report component with detailed scrap analysis and visualizations
// eslint-disable-next-line complexity
export function ScrapAnalysisReport({ filters }: { readonly filters: DashboardFilters }) {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  const { data: scrapData, isLoading, error } = useQuery<ScrapData[]>({
    queryKey: ['scrap-analysis-report', filters],
    queryFn: async (): Promise<ScrapData[]> => {
      const query = buildStageCostsQuery(filters)
      const { data: stageCostsData, error: queryError } = await query

      sortStageCostsData(stageCostsData)

      if (queryError) {
        console.error('❌ Scrap Analysis Query Error:', {
          message: queryError.message,
          code: queryError.code,
          details: queryError.details
        })
        return processFallbackData(filters)
      }

      if (!stageCostsData || stageCostsData.length === 0) {
        return []
      }

      const wcIds = [...new Set(stageCostsData.map((sc) => sc.work_center_id).filter(Boolean) as string[])]
      const moIds = [...new Set(stageCostsData.map((sc) => sc.manufacturing_order_id).filter(Boolean) as string[])]

      const [wcData, moData] = await Promise.all([
        fetchWorkCenters(wcIds),
        fetchManufacturingOrders(moIds)
      ])

      return transformToScrapData(stageCostsData, wcData, moData, isRTL)
    }
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Scissors className="h-8 w-8 animate-pulse mx-auto text-primary" />
          <p className="text-muted-foreground">{t('scrap.loading')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive" className={getGlassClasses()}>
        <AlertDescription>
          {t('scrap.errorLoading')}: {error.message}
        </AlertDescription>
      </Alert>
    )
  }

  if (!scrapData || scrapData.length === 0) {
    return (
      <Alert className={getGlassClasses()}>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {t('scrap.noData')}
        </AlertDescription>
      </Alert>
    )
  }

  // Calculate totals
  const totals = scrapData.reduce((acc, item) => ({
    good_qty: acc.good_qty + item.good_qty,
    scrap_qty: acc.scrap_qty + item.scrap_qty,
    normal_scrap_qty: acc.normal_scrap_qty + item.normal_scrap_qty,
    abnormal_scrap_qty: acc.abnormal_scrap_qty + item.abnormal_scrap_qty,
    normal_scrap_cost: acc.normal_scrap_cost + item.normal_scrap_cost,
    abnormal_scrap_cost: acc.abnormal_scrap_cost + item.abnormal_scrap_cost,
    regrind_cost: acc.regrind_cost + item.regrind_cost,
    waste_credit_amount: acc.waste_credit_amount + item.waste_credit_amount
  }), {
    good_qty: 0,
    scrap_qty: 0,
    normal_scrap_qty: 0,
    abnormal_scrap_qty: 0,
    normal_scrap_cost: 0,
    abnormal_scrap_cost: 0,
    regrind_cost: 0,
    waste_credit_amount: 0
  })

  // Prepare chart data
  const pieData = [
    { name: t('scrap.normalScrap'), value: totals.normal_scrap_qty, cost: totals.normal_scrap_cost },
    { name: t('scrap.abnormalScrap'), value: totals.abnormal_scrap_qty, cost: totals.abnormal_scrap_cost }
  ]

  const barData = scrapData.map(item => ({
    stage: item.stage_name,
    normal: item.normal_scrap_qty,
    abnormal: item.abnormal_scrap_qty,
    normalCost: item.normal_scrap_cost,
    abnormalCost: item.abnormal_scrap_cost
  }))

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
            <Info className="h-5 w-5" />
            {t('scrap.aboutTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className={cn("space-y-2 text-sm", isRTL ? "text-right" : "text-left")}>
          <p>
            <strong>{t('scrap.normalScrapDef')}</strong>:
            {t('scrap.normalScrapDesc')}
          </p>
          <p>
            <strong>{t('scrap.abnormalScrapDef')}</strong>:
            {t('scrap.abnormalScrapDesc')}
          </p>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={getGlassClasses()}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              {t('scrap.normalScrap')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.normal_scrap_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {totals.normal_scrap_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
            </p>
          </CardContent>
        </Card>

        <Card className={getGlassClasses()}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              {t('scrap.abnormalScrap')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.abnormal_scrap_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {totals.abnormal_scrap_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
            </p>
          </CardContent>
        </Card>

        <Card className={getGlassClasses()}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Scissors className="h-4 w-4 text-blue-500" />
              {t('scrap.regrindCostCard')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.regrind_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('scrap.regrindCostSub')}
            </p>
          </CardContent>
        </Card>

        <Card className={getGlassClasses()}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              {t('scrap.wasteCredit')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.waste_credit_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('scrap.wasteCreditSub')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Scrap Table */}
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
            <Scissors className="h-5 w-5" />
            {t('scrap.breakdown')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(isRTL && "text-right")}>{t('scrap.mo')}</TableHead>
                  <TableHead className={cn(isRTL && "text-right")}>{t('scrap.stage')}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{t('scrap.goodQty')}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{t('scrap.totalScrap')}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{t('scrap.normalScrap')}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{t('scrap.abnormalScrap')}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{t('scrap.normalCost')}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{t('scrap.abnormalCost')}</TableHead>
                  <TableHead className={cn("text-right", isRTL && "text-right")}>{t('scrap.normalRate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scrapData.map((item) => (
                  <TableRow key={`${item.order_number}-${item.stage_no}-${item.stage_name}`}>
                    <TableCell>{item.order_number}</TableCell>
                    <TableCell>{item.stage_name}</TableCell>
                    <TableCell className="text-right font-mono">
                      {item.good_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {item.scrap_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-green-600">
                      {item.normal_scrap_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-red-600">
                      {item.abnormal_scrap_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-green-600">
                      {item.normal_scrap_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                    <TableCell className="text-right font-mono text-red-600">
                      {item.abnormal_scrap_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {item.normal_scrap_rate.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals Row */}
                <TableRow className="font-bold bg-muted/50">
                  <TableCell colSpan={2}>{t('scrap.total')}</TableCell>
                  <TableCell className="text-right font-mono">
                    {totals.good_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {totals.scrap_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-green-600">
                    {totals.normal_scrap_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-600">
                    {totals.abnormal_scrap_qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-green-600">
                    {totals.normal_scrap_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-600">
                    {totals.abnormal_scrap_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <Card className={getGlassClasses()}>
          <CardHeader>
            <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
              <Scissors className="h-5 w-5" />
              {t('scrap.distribution')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, idx) => {
                    const colorIndex = idx % COLORS.length
                    return <Cell key={`cell-${entry.name}-${idx}`} fill={COLORS[colorIndex]} />
                  })}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Bar Chart */}
        <Card className={getGlassClasses()}>
          <CardHeader>
            <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
              <Scissors className="h-5 w-5" />
              {t('scrap.byStage')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="normal" name={t('scrap.normalBar')} fill="#00C49F" />
                <Bar dataKey="abnormal" name={t('scrap.abnormalBar')} fill="#FF8042" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
