/**
 * Efficiency Dashboard - لوحة تحكم الكفاءة والأداء
 * عرض تقارير OEE وكفاءة العمالة وتباين التكاليف
 */

import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
  AlertTriangle,
  CheckCircle,
  Factory,
  Gauge,
  Boxes,
  CircleDollarSign,
  ChevronDown,
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
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
// Main Component
// =====================================================

export const EfficiencyDashboard: React.FC = () => {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const dateLocale = isRTL ? ar : enUS

  // State
  const [dateRange, setDateRange] = useState<DateRange>({
    from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd')
  })
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string>('')
  const [activeTab, setActiveTab] = useState('overview')

  // Queries
  const { data: dashboardStats, isLoading: loadingStats, refetch: refetchStats } = useDashboardStats()
  const { data: workCenters } = useWorkCenters()
  
  const { data: laborEfficiency, isLoading: loadingLabor } = useLaborEfficiencyReport({
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

  // Calculated stats
  const avgEfficiency = useMemo(() => {
    if (!laborEfficiency?.length) return 0
    return laborEfficiency.reduce((sum, r) => sum + (r.overall_efficiency_pct || 0), 0) / laborEfficiency.length
  }, [laborEfficiency])

  const avgScrapRate = useMemo(() => {
    if (!laborEfficiency?.length) return 0
    return laborEfficiency.reduce((sum, r) => sum + (r.scrap_rate_pct || 0), 0) / laborEfficiency.length
  }, [laborEfficiency])

  return (
    <div className={cn('space-y-6 p-6', isRTL && 'rtl')}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {isRTL ? 'لوحة تحكم الكفاءة والأداء' : 'Efficiency & Performance Dashboard'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'تحليل شامل لأداء الإنتاج وكفاءة العمليات' : 'Comprehensive analysis of production performance and operational efficiency'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetchStats()}>
            <RefreshCcw className="h-4 w-4" />
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            {isRTL ? 'تصدير التقرير' : 'Export Report'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{isRTL ? 'من تاريخ' : 'From Date'}</Label>
              <Input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{isRTL ? 'إلى تاريخ' : 'To Date'}</Label>
              <Input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{isRTL ? 'مركز العمل' : 'Work Center'}</Label>
              <Select value={selectedWorkCenter || 'all'} onValueChange={(value) => setSelectedWorkCenter(value === 'all' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder={isRTL ? 'جميع مراكز العمل' : 'All Work Centers'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'جميع مراكز العمل' : 'All Work Centers'}</SelectItem>
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
          title={isRTL ? 'كفاءة اليوم' : "Today's Efficiency"}
          value={`${dashboardStats?.today_efficiency?.toFixed(1) || 0}%`}
          icon={<Activity className="h-5 w-5 text-primary" />}
          trend={dashboardStats?.today_efficiency >= 100 ? 'up' : 'down'}
          trendValue={dashboardStats?.today_efficiency >= 100 ? 'On Target' : 'Below Target'}
        />
        <StatCard
          title={isRTL ? 'OEE اليوم' : "Today's OEE"}
          value={`${dashboardStats?.today_oee?.toFixed(1) || 0}%`}
          icon={<Gauge className="h-5 w-5 text-primary" />}
          trend={dashboardStats?.today_oee >= 85 ? 'up' : 'down'}
          description={dashboardStats?.today_oee >= 85 ? 'World Class' : ''}
        />
        <StatCard
          title={isRTL ? 'نسبة الخردة' : 'Scrap Rate'}
          value={`${dashboardStats?.today_scrap_rate?.toFixed(2) || 0}%`}
          icon={<AlertTriangle className="h-5 w-5 text-yellow-500" />}
          trend={dashboardStats?.today_scrap_rate <= 1 ? 'up' : 'down'}
        />
        <StatCard
          title={isRTL ? 'أوامر العمل النشطة' : 'Active Work Orders'}
          value={dashboardStats?.active_work_orders || 0}
          icon={<Factory className="h-5 w-5 text-primary" />}
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="overview">{isRTL ? 'نظرة عامة' : 'Overview'}</TabsTrigger>
          <TabsTrigger value="oee">{isRTL ? 'OEE' : 'OEE'}</TabsTrigger>
          <TabsTrigger value="labor">{isRTL ? 'العمالة' : 'Labor'}</TabsTrigger>
          <TabsTrigger value="variance">{isRTL ? 'التباين' : 'Variance'}</TabsTrigger>
          <TabsTrigger value="materials">{isRTL ? 'المواد' : 'Materials'}</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* OEE Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gauge className="h-5 w-5" />
                  {isRTL ? 'ملخص OEE' : 'OEE Summary'}
                </CardTitle>
                <CardDescription>
                  {isRTL ? 'فعالية المعدات الشاملة' : 'Overall Equipment Effectiveness'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <OEEGauge
                  label={isRTL ? 'التوافر' : 'Availability'}
                  value={overallOEE?.avg_availability || 0}
                  target={90}
                  isWorldClass={overallOEE?.world_class_comparison?.availability}
                />
                <OEEGauge
                  label={isRTL ? 'الأداء' : 'Performance'}
                  value={overallOEE?.avg_performance || 0}
                  target={95}
                  isWorldClass={overallOEE?.world_class_comparison?.performance}
                />
                <OEEGauge
                  label={isRTL ? 'الجودة' : 'Quality'}
                  value={overallOEE?.avg_quality || 0}
                  target={99}
                  isWorldClass={overallOEE?.world_class_comparison?.quality}
                />
                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">{isRTL ? 'OEE الإجمالي' : 'Overall OEE'}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">{overallOEE?.avg_oee?.toFixed(1) || 0}%</span>
                      {overallOEE?.world_class_comparison?.oee && (
                        <Badge className="bg-green-500">{isRTL ? 'عالمي' : 'World Class'}</Badge>
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
                  {isRTL ? 'ملخص التباين' : 'Variance Summary'}
                </CardTitle>
                <CardDescription>
                  {isRTL ? 'تباين التكاليف للفترة المحددة' : 'Cost variances for selected period'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">
                      {isRTL ? 'تباين العمالة' : 'Labor Variance'}
                    </div>
                    <div className={cn(
                      'text-xl font-bold',
                      (totalVariances?.total_labor_variance || 0) < 0 ? 'text-green-600' : 'text-red-600'
                    )}>
                      {(totalVariances?.total_labor_variance || 0).toLocaleString()} SAR
                    </div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">
                      {isRTL ? 'تباين المصاريف' : 'Overhead Variance'}
                    </div>
                    <div className={cn(
                      'text-xl font-bold',
                      (totalVariances?.total_overhead_variance || 0) < 0 ? 'text-green-600' : 'text-red-600'
                    )}>
                      {(totalVariances?.total_overhead_variance || 0).toLocaleString()} SAR
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-primary/10 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">
                    {isRTL ? 'إجمالي التباين' : 'Total Variance'}
                  </div>
                  <div className={cn(
                    'text-2xl font-bold',
                    (totalVariances?.total_variance || 0) < 0 ? 'text-green-600' : 'text-red-600'
                  )}>
                    {(totalVariances?.total_variance || 0).toLocaleString()} SAR
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span>{isRTL ? 'مفضل:' : 'Favorable:'} {totalVariances?.favorable_count || 0}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <span>{isRTL ? 'غير مفضل:' : 'Unfavorable:'} {totalVariances?.unfavorable_count || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Work Center Efficiency Table */}
          <Card>
            <CardHeader>
              <CardTitle>{isRTL ? 'كفاءة مراكز العمل' : 'Work Center Efficiency'}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isRTL ? 'مركز العمل' : 'Work Center'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'العمليات المكتملة' : 'Completed Ops'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'الكمية المنتجة' : 'Produced'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'كفاءة الإعداد' : 'Setup Eff.'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'كفاءة التشغيل' : 'Run Eff.'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'الكفاءة الإجمالية' : 'Overall Eff.'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingWcEfficiency ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        {isRTL ? 'جاري التحميل...' : 'Loading...'}
                      </TableCell>
                    </TableRow>
                  ) : wcEfficiency?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    wcEfficiency?.map((wc, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">
                          {isRTL ? wc.work_center_name_ar || wc.work_center_name : wc.work_center_name}
                        </TableCell>
                        <TableCell className="text-center">{wc.completed_operations}</TableCell>
                        <TableCell className="text-center">{wc.total_produced?.toLocaleString()}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={wc.avg_setup_efficiency >= 100 ? 'default' : 'destructive'}>
                            {wc.avg_setup_efficiency?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={wc.avg_run_efficiency >= 100 ? 'default' : 'destructive'}>
                            {wc.avg_run_efficiency?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={wc.avg_overall_efficiency >= 100 ? 'default' : 'secondary'}>
                            {wc.avg_overall_efficiency?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OEE Tab */}
        <TabsContent value="oee" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{isRTL ? 'تقرير OEE التفصيلي' : 'Detailed OEE Report'}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isRTL ? 'التاريخ' : 'Date'}</TableHead>
                    <TableHead>{isRTL ? 'مركز العمل' : 'Work Center'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'التوافر' : 'Availability'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'الأداء' : 'Performance'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'الجودة' : 'Quality'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'OEE' : 'OEE'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingOEE ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        {isRTL ? 'جاري التحميل...' : 'Loading...'}
                      </TableCell>
                    </TableRow>
                  ) : oeeData?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    oeeData?.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell>{format(new Date(row.production_date), 'yyyy-MM-dd')}</TableCell>
                        <TableCell>{row.work_center_name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={row.availability_pct >= 90 ? 'default' : 'destructive'}>
                            {row.availability_pct?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={row.performance_pct >= 95 ? 'default' : 'destructive'}>
                            {row.performance_pct?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={row.quality_pct >= 99 ? 'default' : 'destructive'}>
                            {row.quality_pct?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={row.oee_pct >= 85 ? 'default' : 'secondary'} className={cn(
                            row.oee_pct >= 85 && 'bg-green-500'
                          )}>
                            {row.oee_pct?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Labor Tab */}
        <TabsContent value="labor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{isRTL ? 'تقرير كفاءة العمالة' : 'Labor Efficiency Report'}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isRTL ? 'رقم الأمر' : 'Order #'}</TableHead>
                    <TableHead>{isRTL ? 'العملية' : 'Operation'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'المخطط' : 'Planned'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'الفعلي' : 'Actual'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'الكفاءة' : 'Efficiency'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'الخردة' : 'Scrap %'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingLabor ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        {isRTL ? 'جاري التحميل...' : 'Loading...'}
                      </TableCell>
                    </TableRow>
                  ) : laborEfficiency?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    laborEfficiency?.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono">{row.work_order_number}</TableCell>
                        <TableCell>{row.operation_name}</TableCell>
                        <TableCell className="text-center">
                          {((row.planned_setup_time || 0) + (row.planned_run_time || 0)).toFixed(0)} min
                        </TableCell>
                        <TableCell className="text-center">
                          {((row.actual_setup_time || 0) + (row.actual_run_time || 0)).toFixed(0)} min
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={row.overall_efficiency_pct >= 100 ? 'default' : 'destructive'}>
                            {row.overall_efficiency_pct?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={row.scrap_rate_pct <= 1 ? 'default' : 'destructive'}>
                            {row.scrap_rate_pct?.toFixed(2)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Variance Tab */}
        <TabsContent value="variance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{isRTL ? 'تقرير تباين التكاليف' : 'Cost Variance Report'}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isRTL ? 'أمر العمل' : 'Work Order'}</TableHead>
                    <TableHead>{isRTL ? 'العملية' : 'Operation'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'تكلفة مخططة' : 'Planned Cost'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'تكلفة فعلية' : 'Actual Cost'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'التباين' : 'Variance'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingVariances ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        {isRTL ? 'جاري التحميل...' : 'Loading...'}
                      </TableCell>
                    </TableRow>
                  ) : costVariances?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    costVariances?.map((row, index) => {
                      const totalPlanned = (row.planned_labor_cost || 0) + (row.planned_overhead_cost || 0)
                      const totalActual = (row.actual_labor_cost || 0) + (row.actual_overhead_cost || 0)
                      const totalVariance = (row.labor_variance || 0) + (row.overhead_variance || 0)
                      return (
                        <TableRow key={index}>
                          <TableCell className="font-mono">{row.work_order_number}</TableCell>
                          <TableCell>{row.operation_name}</TableCell>
                          <TableCell className="text-center">{totalPlanned.toLocaleString()} SAR</TableCell>
                          <TableCell className="text-center">{totalActual.toLocaleString()} SAR</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={totalVariance <= 0 ? 'default' : 'destructive'} className={cn(
                              totalVariance < 0 && 'bg-green-500'
                            )}>
                              {totalVariance > 0 ? '+' : ''}{totalVariance.toLocaleString()} SAR
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Materials Tab */}
        <TabsContent value="materials" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{isRTL ? 'تقرير استهلاك المواد' : 'Material Consumption Report'}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isRTL ? 'أمر العمل' : 'Work Order'}</TableHead>
                    <TableHead>{isRTL ? 'الصنف' : 'Item'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'المخطط' : 'Planned'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'المستهلك' : 'Consumed'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'التباين' : 'Variance'}</TableHead>
                    <TableHead className="text-center">{isRTL ? 'التكلفة' : 'Cost'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMaterials ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        {isRTL ? 'جاري التحميل...' : 'Loading...'}
                      </TableCell>
                    </TableRow>
                  ) : materialConsumption?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    materialConsumption?.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono">{row.work_order_number}</TableCell>
                        <TableCell>{row.item_name}</TableCell>
                        <TableCell className="text-center">{row.planned_quantity?.toLocaleString()}</TableCell>
                        <TableCell className="text-center">{row.consumed_quantity?.toLocaleString()}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={(row.variance_pct || 0) <= 5 ? 'default' : 'destructive'}>
                            {row.variance_pct > 0 ? '+' : ''}{row.variance_pct?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">{row.total_cost?.toLocaleString()} SAR</TableCell>
                      </TableRow>
                    ))
                  )}
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

