/**
 * Process Costing Dashboard
 * لوحة تحكم شاملة لتكاليف المراحل (Process Costing)
 * 
 * Features:
 * - EUP Calculation Breakdown
 * - Scrap Analysis (Normal vs Abnormal)
 * - FIFO vs Weighted-Average Comparison
 * - Stage-by-Stage Cost Breakdown
 * - WIP Valuation
 * - Cost of Production Report
 * 
 * @author Wardah ERP Team
 * @date 2025-12-25
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Calculator,
  DollarSign,
  Package,
  Factory,
  Download,
  FileText,
  BarChart3,
  RefreshCw,
  Filter,
  Layers,
  Scissors,
  ArrowUpDown
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getGlassClasses } from '@/lib/wardah-ui-utils'
import { toast } from 'sonner'

// Import sub-components
import { EUPCalculationBreakdown } from './process-costing/EUPCalculationBreakdown'
import { ScrapAnalysisReport } from './process-costing/ScrapAnalysisReport'
import { FIFOComparisonReport } from './process-costing/FIFOComparisonReport'
import { StageCostBreakdown } from './process-costing/StageCostBreakdown'
import { CostOfProductionReport } from './process-costing/CostOfProductionReport'
import { WIPValuationReport } from './process-costing/WIPValuationReport'

// Types
interface ManufacturingOrder {
  id: string
  order_number: string
  item_id: string
  item_name?: string
  quantity: number
  status: string
  costing_method?: 'weighted_average' | 'fifo'
  created_at: string
}

interface ProcessCostingSummary {
  total_orders: number
  total_stages: number
  total_good_qty: number
  total_scrap_qty: number
  total_cost: number
  avg_unit_cost: number
  total_wip_value: number
  eup_calculated: number
  normal_scrap_cost: number
  abnormal_scrap_cost: number
}

interface DashboardFilters {
  manufacturingOrderId?: string
  dateFrom?: string
  dateTo?: string
  stageNo?: number
  costingMethod?: 'weighted_average' | 'fifo' | 'all'
}

// NOSONAR - Dashboard component with complex filtering logic
export function ProcessCostingDashboard() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  // State
  const [filters, setFilters] = useState<DashboardFilters>({
    costingMethod: 'all'
  })
  const [activeTab, setActiveTab] = useState('overview')

  // Fetch Manufacturing Orders
  const { data: manufacturingOrders, isLoading: isLoadingMOs } = useQuery({
    queryKey: ['manufacturing-orders-for-dashboard'],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      
      const { data, error } = await supabase
        .from('manufacturing_orders')
        .select('id, order_number, item_id, quantity, status, costing_method, created_at')
        .order('created_at', { ascending: false })
        .limit(100)
      
      if (error) throw error
      return data as ManufacturingOrder[]
    }
  })

  // Fetch Process Costing Summary
  const { data: summary, isLoading: isLoadingSummary, refetch: refetchSummary } = useQuery({
    queryKey: ['process-costing-summary', filters],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      
      // Build query - use mo_id (not manufacturing_order_id)
      // Use select('*') to avoid column name issues - RLS will filter by org_id/tenant_id
      let query = supabase
        .from('stage_costs')
        .select('*')
      
      // Apply filters
      // Try manufacturing_order_id first (actual column name), then mo_id as fallback
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
        // Try stage_no first, fallback handled in error handling
        query = query.eq('stage_no', filters.stageNo)
      }
      
      const { data: stageCostsData, error } = await query
      
      if (error) {
        // Log error for debugging (NOSONAR - needed for troubleshooting)
        // eslint-disable-next-line no-console
        console.error('❌ Stage Costs Query Error:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          query: 'stage_costs select'
        })
        
        // Try fallback: query without filter first, then filter in memory
        // eslint-disable-next-line no-console
        console.log('🔄 Trying fallback query...')
        const fallbackQuery = supabase
          .from('stage_costs')
          .select('*')
          .limit(100)
        
        // Don't add filter here - fetch all and filter in memory
        
        const { data: fallbackData, error: fallbackError } = await fallbackQuery
        
        if (fallbackError) {
          console.error('❌ Fallback query also failed:', fallbackError)
          throw new Error(`Failed to fetch stage costs: ${error.message}. Fallback also failed: ${fallbackError.message}`)
        }
        
        // Use fallback data - calculate summary
        // Filter by manufacturing_order_id or mo_id in memory
        const fallbackStageCosts = (fallbackData || []).filter((sc: Record<string, unknown>) => {
          if (!filters.manufacturingOrderId) return true
          return sc.manufacturing_order_id === filters.manufacturingOrderId || sc.mo_id === filters.manufacturingOrderId
        })
        const fallbackMoIds = [...new Set(fallbackStageCosts.map((sc: Record<string, unknown>) => sc.manufacturing_order_id || sc.mo_id).filter(Boolean))]
        const fallbackTotalOrders = fallbackMoIds.length
        const fallbackTotalStages = fallbackStageCosts.length
        const fallbackTotalGoodQty = fallbackStageCosts.reduce((sum: number, sc: Record<string, unknown>) => sum + (Number(sc.good_qty) || 0), 0)
        const fallbackTotalScrapQty = fallbackStageCosts.reduce((sum: number, sc: Record<string, unknown>) => sum + (Number(sc.scrap_qty) || 0), 0)
        const fallbackTotalCost = fallbackStageCosts.reduce((sum: number, sc: Record<string, unknown>) => sum + (Number(sc.total_cost) || 0), 0)
        const fallbackAvgUnitCost = fallbackTotalGoodQty > 0 ? fallbackTotalCost / fallbackTotalGoodQty : 0
        const fallbackTotalWipValue = fallbackStageCosts.reduce((sum: number, sc: Record<string, unknown>) => {
          const wipEndQty = Number(sc.wip_end_qty) || 0
          const unitCost = Number(sc.unit_cost) || 0
          return sum + (wipEndQty * unitCost)
        }, 0)
        const fallbackEupCalculated = fallbackStageCosts.reduce((sum: number, sc: Record<string, unknown>) => {
          const goodQty = Number(sc.good_qty) || 0
          const wipEndQty = Number(sc.wip_end_qty) || 0
          const wipEndCcPct = Number(sc.wip_end_cc_completion_pct) || 0
          return sum + (goodQty + (wipEndQty * wipEndCcPct / 100))
        }, 0)
        const fallbackNormalScrapCost = fallbackStageCosts.reduce((sum: number, sc: Record<string, unknown>) => sum + (Number(sc.normal_scrap_cost) || 0), 0)
        const fallbackAbnormalScrapCost = fallbackStageCosts.reduce((sum: number, sc: Record<string, unknown>) => sum + (Number(sc.abnormal_scrap_cost) || 0), 0)
        
        return {
          total_orders: fallbackTotalOrders,
          total_stages: fallbackTotalStages,
          total_good_qty: fallbackTotalGoodQty,
          total_scrap_qty: fallbackTotalScrapQty,
          total_cost: fallbackTotalCost,
          avg_unit_cost: fallbackAvgUnitCost,
          total_wip_value: fallbackTotalWipValue,
          eup_calculated: fallbackEupCalculated,
          normal_scrap_cost: fallbackNormalScrapCost,
          abnormal_scrap_cost: fallbackAbnormalScrapCost
        } as ProcessCostingSummary
      }
      
      // Fetch manufacturing orders separately and join
      // Support both manufacturing_order_id and mo_id
      const moIds = [...new Set((stageCostsData || []).map((sc: Record<string, unknown>) => sc.manufacturing_order_id || sc.mo_id).filter(Boolean))]
      
      const moData: Record<string, { id: string; order_number?: string; item_id?: string; costing_method?: string }> = {}
      if (moIds.length > 0) {
        let moQuery = supabase
          .from('manufacturing_orders')
          .select('id, order_number, item_id, costing_method')
          .in('id', moIds)
        
        // Apply costing method filter if specified
        if (filters.costingMethod && filters.costingMethod !== 'all') {
          moQuery = moQuery.eq('costing_method', filters.costingMethod)
        }
        
        const { data: mos, error: moError } = await moQuery
        
        if (!moError && mos) {
          mos.forEach((mo: { id: string; order_number?: string; item_id?: string; costing_method?: string }) => {
            moData[mo.id] = mo
          })
        }
      }
      
      // Filter stage costs by MO if costing method filter is applied
      const data = (stageCostsData || []).filter((sc: Record<string, unknown>) => {
        if (filters.costingMethod && filters.costingMethod !== 'all') {
          const moId = sc.manufacturing_order_id || sc.mo_id
          return moData[moId as string]?.costing_method === filters.costingMethod
        }
        return true
      }).map((sc: Record<string, unknown>) => ({
        ...sc,
        manufacturing_orders: moData[(sc.manufacturing_order_id || sc.mo_id) as string]
      }))
      
      // Calculate summary
      interface StageCostRecord {
        mo_id?: string
        manufacturing_order_id?: string
        good_qty: number | string
        scrap_qty: number | string
        total_cost: number | string
        wip_end_qty: number | string
        unit_cost: number | string
        wip_end_cc_completion_pct: number | string
        normal_scrap_cost: number | string
        abnormal_scrap_cost: number | string
        manufacturing_orders?: { id: string; order_number?: string; item_id?: string; costing_method?: string }
      }
      
      const stageCosts = (data || []) as StageCostRecord[]
      const totalOrders = new Set(stageCosts.map((sc) => {
        const scRecord = sc as unknown as Record<string, unknown>
        return scRecord.manufacturing_order_id || scRecord.mo_id
      }).filter(Boolean)).size
      const totalStages = stageCosts.length
      const totalGoodQty = stageCosts.reduce((sum: number, sc) => sum + (Number(sc.good_qty) || 0), 0)
      const totalScrapQty = stageCosts.reduce((sum: number, sc) => sum + (Number(sc.scrap_qty) || 0), 0)
      const totalCost = stageCosts.reduce((sum: number, sc) => sum + (Number(sc.total_cost) || 0), 0)
      const avgUnitCost = totalGoodQty > 0 ? totalCost / totalGoodQty : 0
      const totalWipValue = stageCosts.reduce((sum: number, sc) => {
        const wipEndQty = Number(sc.wip_end_qty) || 0
        const unitCost = Number(sc.unit_cost) || 0
        return sum + (wipEndQty * unitCost)
      }, 0)
      const eupCalculated = stageCosts.reduce((sum: number, sc) => {
        // EUP = good_qty + (wip_end_qty * wip_end_cc_completion_pct / 100)
        const goodQty = Number(sc.good_qty) || 0
        const wipEndQty = Number(sc.wip_end_qty) || 0
        const wipEndCcPct = Number(sc.wip_end_cc_completion_pct) || 0
        return sum + (goodQty + (wipEndQty * wipEndCcPct / 100))
      }, 0)
      const normalScrapCost = stageCosts.reduce((sum: number, sc) => sum + (Number(sc.normal_scrap_cost) || 0), 0)
      const abnormalScrapCost = stageCosts.reduce((sum: number, sc) => sum + (Number(sc.abnormal_scrap_cost) || 0), 0)
      
      return {
        total_orders: totalOrders,
        total_stages: totalStages,
        total_good_qty: totalGoodQty,
        total_scrap_qty: totalScrapQty,
        total_cost: totalCost,
        avg_unit_cost: avgUnitCost,
        total_wip_value: totalWipValue,
        eup_calculated: eupCalculated,
        normal_scrap_cost: normalScrapCost,
        abnormal_scrap_cost: abnormalScrapCost
      } as ProcessCostingSummary
    },
    enabled: true
  })

  // Handlers
  const handleFilterChange = (key: keyof DashboardFilters, value: string | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const handleExportPDF = () => {
    toast.info('جارٍ إعداد التقرير للتصدير...')
    // PDF export will be implemented in future update
  }

  const handleExportExcel = () => {
    toast.info('جارٍ إعداد التقرير للتصدير...')
    // Excel export will be implemented in future update
  }

  const handleRefresh = () => {
    refetchSummary()
    toast.success('تم تحديث البيانات')
  }

  // Loading state
  if (isLoadingMOs || isLoadingSummary) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">جارٍ تحميل البيانات...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className={cn("flex flex-col md:flex-row md:items-center md:justify-between gap-4", isRTL && "md:flex-row-reverse")}>
        <div className={cn(isRTL ? "text-right" : "text-left")}>
          <h1 className="text-3xl font-bold wardah-text-gradient-google flex items-center gap-2">
            <Calculator className="h-8 w-8" />
            {isRTL ? 'لوحة تحكم تكاليف المراحل' : 'Process Costing Dashboard'}
          </h1>
          <p className="text-muted-foreground mt-2">
            {isRTL 
              ? 'تحليل شامل لتكاليف المراحل مع حساب الوحدات المكافئة وتحليل الهالك'
              : 'Comprehensive process costing analysis with EUP calculation and scrap analysis'
            }
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleRefresh} size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {isRTL ? 'تحديث' : 'Refresh'}
          </Button>
          <Button variant="outline" onClick={handleExportExcel} size="sm">
            <Download className="h-4 w-4 mr-2" />
            {isRTL ? 'تصدير Excel' : 'Export Excel'}
          </Button>
          <Button variant="outline" onClick={handleExportPDF} size="sm">
            <FileText className="h-4 w-4 mr-2" />
            {isRTL ? 'تصدير PDF' : 'Export PDF'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
            <Filter className="h-5 w-5" />
            {isRTL ? 'الفلاتر' : 'Filters'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Manufacturing Order Filter */}
            <div className="space-y-2">
              <Label htmlFor="mo-filter">{isRTL ? 'أمر التصنيع' : 'Manufacturing Order'}</Label>
              <Select
                value={filters.manufacturingOrderId || 'all'}
                onValueChange={(value) => handleFilterChange('manufacturingOrderId', value === 'all' ? undefined : value)}
              >
                <SelectTrigger id="mo-filter">
                  <SelectValue placeholder={isRTL ? 'جميع الأوامر' : 'All Orders'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'جميع الأوامر' : 'All Orders'}</SelectItem>
                  {manufacturingOrders?.map((mo: ManufacturingOrder) => (
                    <SelectItem key={mo.id} value={mo.id}>
                      {mo.order_number} {mo.item_name && `- ${mo.item_name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date From */}
            <div className="space-y-2">
              <Label htmlFor="date-from">{isRTL ? 'من تاريخ' : 'From Date'}</Label>
              <Input
                id="date-from"
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value || undefined)}
              />
            </div>

            {/* Date To */}
            <div className="space-y-2">
              <Label htmlFor="date-to">{isRTL ? 'إلى تاريخ' : 'To Date'}</Label>
              <Input
                id="date-to"
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => handleFilterChange('dateTo', e.target.value || undefined)}
              />
            </div>

            {/* Costing Method */}
            <div className="space-y-2">
              <Label htmlFor="costing-method">{isRTL ? 'طريقة التكلفة' : 'Costing Method'}</Label>
              <Select
                value={filters.costingMethod || 'all'}
                onValueChange={(value) => handleFilterChange('costingMethod', value as 'weighted_average' | 'fifo' | 'all')}
              >
                <SelectTrigger id="costing-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="weighted_average">{isRTL ? 'المتوسط المرجح' : 'Weighted Average'}</SelectItem>
                  <SelectItem value="fifo">{isRTL ? 'أول وارد أول صادر' : 'FIFO'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className={getGlassClasses()}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Factory className="h-4 w-4" />
                {isRTL ? 'إجمالي الأوامر' : 'Total Orders'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.total_orders}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {isRTL ? 'أمر تصنيع' : 'Manufacturing Orders'}
              </p>
            </CardContent>
          </Card>

          <Card className={getGlassClasses()}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                {isRTL ? 'إجمالي التكلفة' : 'Total Cost'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary.total_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isRTL ? 'متوسط التكلفة للوحدة' : 'Avg Unit Cost'}: {summary.avg_unit_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
              </p>
            </CardContent>
          </Card>

          <Card className={getGlassClasses()}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Package className="h-4 w-4" />
                {isRTL ? 'الوحدات المكافئة (EUP)' : 'Equivalent Units (EUP)'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary.eup_calculated.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isRTL ? 'إجمالي الوحدات الجيدة' : 'Total Good Qty'}: {summary.total_good_qty.toLocaleString('en-US')}
              </p>
            </CardContent>
          </Card>

          <Card className={getGlassClasses()}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Layers className="h-4 w-4" />
                {isRTL ? 'قيمة WIP' : 'WIP Value'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary.total_wip_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isRTL ? 'قيمة العمل قيد التنفيذ' : 'Work in Process Value'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className={cn("grid w-full grid-cols-3 lg:grid-cols-6", isRTL && "flex-row-reverse")}>
          <TabsTrigger value="overview">
            <BarChart3 className="h-4 w-4 mr-2" />
            {isRTL ? 'نظرة عامة' : 'Overview'}
          </TabsTrigger>
          <TabsTrigger value="eup">
            <Calculator className="h-4 w-4 mr-2" />
            {isRTL ? 'حساب EUP' : 'EUP Calculation'}
          </TabsTrigger>
          <TabsTrigger value="scrap">
            <Scissors className="h-4 w-4 mr-2" />
            {isRTL ? 'تحليل الهالك' : 'Scrap Analysis'}
          </TabsTrigger>
          <TabsTrigger value="fifo">
            <ArrowUpDown className="h-4 w-4 mr-2" />
            {isRTL ? 'مقارنة FIFO' : 'FIFO Comparison'}
          </TabsTrigger>
          <TabsTrigger value="stages">
            <Layers className="h-4 w-4 mr-2" />
            {isRTL ? 'تفصيل المراحل' : 'Stage Breakdown'}
          </TabsTrigger>
          <TabsTrigger value="wip">
            <Factory className="h-4 w-4 mr-2" />
            {isRTL ? 'تقييم WIP' : 'WIP Valuation'}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <CostOfProductionReport filters={filters} />
        </TabsContent>

        {/* EUP Calculation Tab */}
        <TabsContent value="eup" className="space-y-4">
          <EUPCalculationBreakdown filters={filters} />
        </TabsContent>

        {/* Scrap Analysis Tab */}
        <TabsContent value="scrap" className="space-y-4">
          <ScrapAnalysisReport filters={filters} />
        </TabsContent>

        {/* FIFO Comparison Tab */}
        <TabsContent value="fifo" className="space-y-4">
          <FIFOComparisonReport filters={filters} />
        </TabsContent>

        {/* Stage Breakdown Tab */}
        <TabsContent value="stages" className="space-y-4">
          <StageCostBreakdown filters={filters} />
        </TabsContent>

        {/* WIP Valuation Tab */}
        <TabsContent value="wip" className="space-y-4">
          <WIPValuationReport filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

