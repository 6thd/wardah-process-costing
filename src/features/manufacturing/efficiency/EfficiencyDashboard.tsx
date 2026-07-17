/**
 * Efficiency Dashboard - لوحة تحكم الكفاءة والأداء
 * عرض تقارير OEE وكفاءة العمالة وتباين التكاليف
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, subDays } from 'date-fns'
import {
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Factory,
  Gauge,
  CircleDollarSign,
  RefreshCcw,
  Download
} from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

import {
  useDashboardStats,
  useLaborEfficiencyReport,
  useWorkCenterEfficiencySummary,
  useCostVarianceReport,
  useTotalVariances,
  useOEEReport,
  useOverallOEE,
  useMaterialConsumptionReport
} from '@/hooks/manufacturing/useEfficiency'
import { useWorkCenters } from '@/hooks/manufacturing/useMES'
import {
  WorkCenterEfficiencyTable,
  OEETable,
  LaborEfficiencyTable,
  CostVarianceTable,
  MaterialConsumptionTable
} from './components/EfficiencyTables'

// =====================================================
// Types
// =====================================================

interface DateRange {
  from: string
  to: string
}

// =====================================================
// Helper Components
// =====================================================

const StatCard: React.FC<{
  title: string
  value: string | number
  icon: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  description?: string
  className?: string
}> = ({ title, value, icon, trend, trendValue, description, className }) => {
  const getTrendIcon = () => {
    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-green-500" />
    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-500" />
    return null
  }

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="rounded-lg bg-primary/10 p-2">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {(trend || description) && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            {getTrendIcon()}
            {trendValue && <span className={cn(
              trend === 'up' && 'text-green-600',
              trend === 'down' && 'text-red-600'
            )}>{trendValue}</span>}
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

const OEEGauge: React.FC<{
  label: string
  value: number
  target: number
  isWorldClass?: boolean
}> = ({ label, value, target, isWorldClass }) => {
  const getColor = () => {
    if (value >= target) return 'bg-green-500'
    if (value >= target * 0.8) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{value.toFixed(1)}%</span>
          {isWorldClass && <Badge variant="outline" className="text-green-600 border-green-600">World Class</Badge>}
        </div>
      </div>
      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full transition-all', getColor())} style={{ width: `${Math.min(value, 100)}%` }} />
        <div className="absolute top-0 h-full w-px bg-foreground/50" style={{ left: `${target}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0%</span>
        <span>Target: {target}%</span>
        <span>100%</span>
      </div>
    </div>
  )
}

// =====================================================
// Helper Functions
// =====================================================

const getEfficiencyTrend = (efficiency: number | undefined, target: number): 'up' | 'down' => {
  return (efficiency || 0) >= target ? 'up' : 'down'
}

const getEfficiencyTrendValue = (efficiency: number | undefined, target: number): string => {
  return (efficiency || 0) >= target ? 'On Target' : 'Below Target'
}

const getOEEStatus = (oee: number | undefined, target: number): string => {
  return (oee || 0) >= target ? 'World Class' : ''
}

const getScrapTrend = (scrapRate: number | undefined, threshold: number): 'up' | 'down' => {
  return (scrapRate || 0) <= threshold ? 'up' : 'down'
}

const getVarianceColor = (variance: number | undefined): string => {
  return (variance || 0) < 0 ? 'text-green-600' : 'text-red-600'
}

// =====================================================
// Main Component
// =====================================================

// eslint-disable-next-line complexity
export const EfficiencyDashboard: React.FC = () => {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  // State
  const [dateRange, setDateRange] = useState<DateRange>({
    from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd')
  })
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string>('')
  const [activeTab, setActiveTab] = useState('overview')

  // Queries
  const { data: dashboardStats, refetch: refetchStats, isError: statsError } = useDashboardStats()
  const { data: workCenters } = useWorkCenters()

  const { data: laborEfficiency, isLoading: loadingLabor, isError: laborError } = useLaborEfficiencyReport({
    workCenterId: selectedWorkCenter || undefined,
    fromDate: dateRange.from,
    toDate: dateRange.to
  })

  const { data: wcEfficiency, isLoading: loadingWcEfficiency } = useWorkCenterEfficiencySummary({
    workCenterId: selectedWorkCenter || undefined,
    fromDate: dateRange.from,
    toDate: dateRange.to
  })

  const { data: costVariances, isLoading: loadingVariances } = useCostVarianceReport({
    workCenterId: selectedWorkCenter || undefined,
    fromDate: dateRange.from,
    toDate: dateRange.to
  })

  const { data: totalVariances } = useTotalVariances(dateRange.from, dateRange.to)

  const { data: oeeData, isLoading: loadingOEE } = useOEEReport({
    workCenterId: selectedWorkCenter || undefined,
    fromDate: dateRange.from,
    toDate: dateRange.to
  })

  const { data: overallOEE } = useOverallOEE(dateRange.from, dateRange.to)

  const { data: materialConsumption, isLoading: loadingMaterials } = useMaterialConsumptionReport({
    fromDate: dateRange.from,
    toDate: dateRange.to
  })

  return (
    <div className={cn('space-y-6 p-6', isRTL && 'rtl')}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t('efficiency.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('efficiency.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetchStats()}>
            <RefreshCcw className="h-4 w-4" />
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            {t('efficiency.exportReport')}
          </Button>
        </div>
      </div>

      {/* Migration Warning */}
      {(laborError || statsError) && (
        <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-800 dark:text-yellow-200">
            {t('efficiency.viewsNotFound')}
          </AlertTitle>
          <AlertDescription className="text-yellow-700 dark:text-yellow-300">
            {t('efficiency.viewsNotFoundDescPre')}{' '}
            <code className="px-1 py-0.5 bg-yellow-100 dark:bg-yellow-900 rounded">75_manufacturing_integration.sql</code>
            {' '}{t('efficiency.viewsNotFoundDescPost')}
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t('efficiency.fromDate')}</Label>
              <Input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('efficiency.toDate')}</Label>
              <Input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('efficiency.workCenter')}</Label>
              <Select value={selectedWorkCenter || 'all'} onValueChange={(value) => setSelectedWorkCenter(value === 'all' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('efficiency.allWorkCenters')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('efficiency.allWorkCenters')}</SelectItem>
                  {workCenters?.map(wc => (
                    <SelectItem key={wc.id} value={wc.id}>
                      {isRTL ? wc.name_ar || wc.name : wc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t('efficiency.todaysEfficiency')}
          value={`${dashboardStats?.today_efficiency?.toFixed(1) || 0}%`}
          icon={<Activity className="h-5 w-5 text-primary" />}
          trend={getEfficiencyTrend(dashboardStats?.today_efficiency, 100)}
          trendValue={getEfficiencyTrendValue(dashboardStats?.today_efficiency, 100)}
        />
        <StatCard
          title={t('efficiency.todaysOEE')}
          value={`${dashboardStats?.today_oee?.toFixed(1) || 0}%`}
          icon={<Gauge className="h-5 w-5 text-primary" />}
          trend={getEfficiencyTrend(dashboardStats?.today_oee, 85)}
          description={getOEEStatus(dashboardStats?.today_oee, 85)}
        />
        <StatCard
          title={t('efficiency.scrapRate')}
          value={`${dashboardStats?.today_scrap_rate?.toFixed(2) || 0}%`}
          icon={<AlertTriangle className="h-5 w-5 text-yellow-500" />}
          trend={getScrapTrend(dashboardStats?.today_scrap_rate, 1)}
        />
        <StatCard
          title={t('efficiency.activeWorkOrders')}
          value={dashboardStats?.active_work_orders || 0}
          icon={<Factory className="h-5 w-5 text-primary" />}
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="overview">{t('navigation.overview')}</TabsTrigger>
          <TabsTrigger value="oee">OEE</TabsTrigger>
          <TabsTrigger value="labor">{t('efficiency.labor')}</TabsTrigger>
          <TabsTrigger value="variance">{t('efficiency.varianceTab')}</TabsTrigger>
          <TabsTrigger value="materials">{t('efficiency.materials')}</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* OEE Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gauge className="h-5 w-5" />
                  {t('efficiency.oeeSummary')}
                </CardTitle>
                <CardDescription>
                  {t('efficiency.overallEquipmentEffectiveness')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <OEEGauge
                  label={t('efficiency.availability')}
                  value={overallOEE?.avg_availability || 0}
                  target={90}
                  isWorldClass={overallOEE?.world_class_comparison?.availability}
                />
                <OEEGauge
                  label={t('efficiency.performance')}
                  value={overallOEE?.avg_performance || 0}
                  target={95}
                  isWorldClass={overallOEE?.world_class_comparison?.performance}
                />
                <OEEGauge
                  label={t('efficiency.quality')}
                  value={overallOEE?.avg_quality || 0}
                  target={99}
                  isWorldClass={overallOEE?.world_class_comparison?.quality}
                />
                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">{t('efficiency.overallOEE')}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">{overallOEE?.avg_oee?.toFixed(1) || 0}%</span>
                      {overallOEE?.world_class_comparison?.oee && (
                        <Badge className="bg-green-500">{t('efficiency.worldClass')}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Variance Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CircleDollarSign className="h-5 w-5" />
                  {t('efficiency.varianceSummary')}
                </CardTitle>
                <CardDescription>
                  {t('efficiency.varianceSummaryDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">
                      {t('efficiency.laborVariance')}
                    </div>
                    <div className={cn(
                      'text-xl font-bold',
                      getVarianceColor(totalVariances?.total_labor_variance)
                    )}>
                      {(totalVariances?.total_labor_variance || 0).toLocaleString()} SAR
                    </div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">
                      {t('efficiency.overheadVariance')}
                    </div>
                    <div className={cn(
                      'text-xl font-bold',
                      getVarianceColor(totalVariances?.total_overhead_variance)
                    )}>
                      {(totalVariances?.total_overhead_variance || 0).toLocaleString()} SAR
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-primary/10 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">
                    {t('efficiency.totalVariance')}
                  </div>
                  <div className={cn(
                    'text-2xl font-bold',
                    getVarianceColor(totalVariances?.total_variance)
                  )}>
                    {(totalVariances?.total_variance || 0).toLocaleString()} SAR
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span>{t('efficiency.favorable')} {totalVariances?.favorable_count || 0}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <span>{t('efficiency.unfavorable')} {totalVariances?.unfavorable_count || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Work Center Efficiency Table */}
          <Card>
            <CardHeader>
              <CardTitle>{t('efficiency.workCenterEfficiency')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('efficiency.workCenter')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.completedOps')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.produced')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.setupEff')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.runEff')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.overallEff')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <WorkCenterEfficiencyTable
                    data={wcEfficiency}
                    isLoading={loadingWcEfficiency}
                    isRTL={isRTL}
                  />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OEE Tab */}
        <TabsContent value="oee" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('efficiency.detailedOEEReport')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.date')}</TableHead>
                    <TableHead>{t('efficiency.workCenter')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.availability')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.performance')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.quality')}</TableHead>
                    <TableHead className="text-center">OEE</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <OEETable
                    data={oeeData}
                    isLoading={loadingOEE}
                  />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Labor Tab */}
        <TabsContent value="labor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('efficiency.laborEfficiencyReport')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('efficiency.orderNo')}</TableHead>
                    <TableHead>{t('efficiency.operation')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.planned')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.actual')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.efficiencyCol')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.scrapPct')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <LaborEfficiencyTable
                    data={laborEfficiency}
                    isLoading={loadingLabor}
                  />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Variance Tab */}
        <TabsContent value="variance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('efficiency.costVarianceReport')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('efficiency.workOrder')}</TableHead>
                    <TableHead>{t('efficiency.operation')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.plannedCost')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.actualCost')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.varianceCol')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <CostVarianceTable
                    data={costVariances}
                    isLoading={loadingVariances}
                  />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Materials Tab */}
        <TabsContent value="materials" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('efficiency.materialConsumptionReport')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('efficiency.workOrder')}</TableHead>
                    <TableHead>{t('efficiency.item')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.planned')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.consumed')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.varianceCol')}</TableHead>
                    <TableHead className="text-center">{t('efficiency.cost')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <MaterialConsumptionTable
                    data={materialConsumption}
                    isLoading={loadingMaterials}
                  />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default EfficiencyDashboard
