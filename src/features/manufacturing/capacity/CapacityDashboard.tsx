/**
 * Capacity Dashboard - لوحة تخطيط الطاقة الإنتاجية
 */

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  RefreshCw,
  Calendar,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  Clock,
  Factory,
  Gauge,
  Target,
  Zap,
  CalendarDays,
} from 'lucide-react'
import {
  useBottlenecks,
  useCapacitySummary,
  useWeeklyScheduleSummary,
  usePredictDelays
} from '@/hooks/manufacturing/useCapacity'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend
} from 'recharts'

export function CapacityDashboard() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  // Date range for analysis
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)

  const [period, setPeriod] = useState<'week' | 'month'>('week')

  const startDate = period === 'week'
    ? startOfWeek.toISOString().split('T')[0]
    : new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]

  const endDate = period === 'week'
    ? endOfWeek.toISOString().split('T')[0]
    : new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]

  // Queries
  const { data: bottlenecks, isLoading: loadingBottlenecks } = useBottlenecks(startDate, endDate)
  const { data: capacitySummary, isLoading: loadingSummary } = useCapacitySummary()
  const { data: weeklySummary } = useWeeklyScheduleSummary()
  const { data: predictions } = usePredictDelays(7)

  // Chart data
  const chartData = useMemo(() => {
    if (!bottlenecks) return []
    return bottlenecks.map(b => ({
      name: b.work_center_name,
      utilization: b.utilization_pct,
      available: b.available_hours,
      planned: b.planned_hours,
      fill: b.utilization_pct > 100 ? '#ef4444' :
            b.utilization_pct > 85 ? '#f59e0b' :
            b.utilization_pct > 50 ? '#22c55e' : '#3b82f6'
    }))
  }, [bottlenecks])

  const statusDistribution = useMemo(() => {
    if (!weeklySummary) return []
    return [
      { name: t('capacity.completed'), value: weeklySummary.completed, color: '#22c55e' },
      { name: t('capacity.inProgress'), value: weeklySummary.in_progress, color: '#3b82f6' },
      { name: t('capacity.delayed'), value: weeklySummary.delayed, color: '#ef4444' },
      { name: t('capacity.scheduled'), value: weeklySummary.total_scheduled - weeklySummary.completed - weeklySummary.in_progress - weeklySummary.delayed, color: '#9ca3af' },
    ].filter(d => d.value > 0)
  }, [weeklySummary, i18n.language])

  const getUtilizationBadge = (pct: number) => {
    if (pct > 100) return <Badge variant="destructive">{t('capacity.overloaded')}</Badge>
    if (pct > 85) return <Badge className="bg-yellow-500">{t('capacity.highLoad')}</Badge>
    if (pct > 50) return <Badge className="bg-green-500">{t('capacity.normal')}</Badge>
    return <Badge variant="secondary">{t('capacity.lowLoad')}</Badge>
  }

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return <Badge variant="destructive">{t('capacity.critical')}</Badge>
      case 'HIGH':
        return <Badge className="bg-orange-500">{t('capacity.high')}</Badge>
      case 'MEDIUM':
        return <Badge className="bg-yellow-500">{t('capacity.medium')}</Badge>
      default:
        return <Badge variant="secondary">{t('capacity.low')}</Badge>
    }
  }

  return (
    <div className={`space-y-6 p-6 ${isRTL ? 'rtl' : 'ltr'}`}>
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold wardah-text-gradient-google">
            <Gauge className="inline-block w-8 h-8 mr-2" />
            {t('capacity.planningTitle')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('capacity.planningSubtitle')}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={period} onValueChange={(v) => setPeriod(v as 'week' | 'month')}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">{t('capacity.thisWeek')}</SelectItem>
              <SelectItem value="month">{t('capacity.thisMonth')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="wardah-glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900">
                <CalendarDays className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('capacity.scheduledOrders')}</p>
                <p className="text-2xl font-bold">{weeklySummary?.total_scheduled || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="wardah-glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-green-100 rounded-lg dark:bg-green-900">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('capacity.avgUtilization')}</p>
                <p className="text-2xl font-bold">{weeklySummary?.utilization_avg || 0}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="wardah-glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-red-100 rounded-lg dark:bg-red-900">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('capacity.bottlenecksLabel')}</p>
                <p className="text-2xl font-bold">
                  {bottlenecks?.filter(b => b.is_bottleneck).length || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="wardah-glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-yellow-100 rounded-lg dark:bg-yellow-900">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('capacity.predictedDelays')}</p>
                <p className="text-2xl font-bold">{predictions?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">
            <BarChart3 className="w-4 h-4 mr-2" />
            {t('capacity.overview')}
          </TabsTrigger>
          <TabsTrigger value="bottlenecks">
            <AlertTriangle className="w-4 h-4 mr-2" />
            {t('capacity.bottlenecksTab')}
          </TabsTrigger>
          <TabsTrigger value="predictions">
            <Target className="w-4 h-4 mr-2" />
            {t('capacity.predictions')}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Utilization Chart */}
            <Card className="wardah-glass-card">
              <CardHeader>
                <CardTitle>{t('capacity.workCenterUtil')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingBottlenecks ? (
                  <div className="flex justify-center items-center h-64">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 120]} />
                      <YAxis dataKey="name" type="category" width={100} />
                      <Tooltip
                        formatter={(value: number) => [`${value}%`, t('capacity.utilizationLabel')]}
                      />
                      <Bar dataKey="utilization" radius={[0, 4, 4, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Schedule Status */}
            <Card className="wardah-glass-card">
              <CardHeader>
                <CardTitle>{t('capacity.scheduleStatus')}</CardTitle>
              </CardHeader>
              <CardContent>
                {statusDistribution.length === 0 ? (
                  <div className="flex justify-center items-center h-64">
                    <p className="text-muted-foreground">{t('capacity.noData')}</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {statusDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Capacity Summary Table */}
          <Card className="wardah-glass-card">
            <CardHeader>
              <CardTitle>{t('capacity.capacitySummary')}</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingSummary ? (
                <div className="flex justify-center items-center h-32">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('capacity.workCenter')}</TableHead>
                      <TableHead>{t('capacity.machines')}</TableHead>
                      <TableHead>{t('capacity.hoursPerDay')}</TableHead>
                      <TableHead>{t('capacity.utilizationLabel')}</TableHead>
                      <TableHead>{t('capacity.statusLabel')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {capacitySummary?.map((item) => (
                      <TableRow key={item.work_center_id}>
                        <TableCell className="font-medium">{item.work_center_name}</TableCell>
                        <TableCell>{item.number_of_machines}</TableCell>
                        <TableCell>{item.capacity_hours_per_day}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={Math.min(item.utilization_pct, 100)} className="w-24 h-2" />
                            <span className="text-sm">{item.utilization_pct}%</span>
                          </div>
                        </TableCell>
                        <TableCell>{getUtilizationBadge(item.utilization_pct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bottlenecks Tab */}
        <TabsContent value="bottlenecks" className="space-y-4">
          <Card className="wardah-glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                {t('capacity.bottleneckAnalysis')}
              </CardTitle>
              <CardDescription>
                {t('capacity.bottleneckDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBottlenecks ? (
                <div className="flex justify-center items-center h-32">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                </div>
              ) : bottlenecks?.length === 0 ? (
                <div className="text-center py-12">
                  <Zap className="mx-auto h-12 w-12 text-green-500" />
                  <h3 className="mt-2 text-lg font-medium">{t('capacity.noBottlenecks')}</h3>
                  <p className="mt-1 text-muted-foreground">
                    {t('capacity.noBottlenecksDesc')}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('capacity.workCenter')}</TableHead>
                      <TableHead>{t('capacity.availableHours')}</TableHead>
                      <TableHead>{t('capacity.plannedHours')}</TableHead>
                      <TableHead>{t('capacity.utilizationLabel')}</TableHead>
                      <TableHead>{t('capacity.severity')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bottlenecks?.filter(b => b.is_bottleneck).map((item) => (
                      <TableRow key={item.work_center_id} className="bg-red-50 dark:bg-red-900/10">
                        <TableCell className="font-medium">{item.work_center_name}</TableCell>
                        <TableCell>{item.available_hours.toFixed(1)}</TableCell>
                        <TableCell>{item.planned_hours.toFixed(1)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress
                              value={Math.min(item.utilization_pct, 100)}
                              className="w-24 h-2"
                            />
                            <span className="text-sm font-medium text-red-600">
                              {item.utilization_pct}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{getSeverityBadge(item.bottleneck_severity)}</TableCell>
                      </TableRow>
                    ))}
                    {bottlenecks?.filter(b => !b.is_bottleneck).map((item) => (
                      <TableRow key={item.work_center_id}>
                        <TableCell className="font-medium">{item.work_center_name}</TableCell>
                        <TableCell>{item.available_hours.toFixed(1)}</TableCell>
                        <TableCell>{item.planned_hours.toFixed(1)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={item.utilization_pct} className="w-24 h-2" />
                            <span className="text-sm">{item.utilization_pct}%</span>
                          </div>
                        </TableCell>
                        <TableCell>{getSeverityBadge(item.bottleneck_severity)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Predictions Tab */}
        <TabsContent value="predictions" className="space-y-4">
          <Card className="wardah-glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                {t('capacity.delayPredictions')}
              </CardTitle>
              <CardDescription>
                {t('capacity.delayPredictionsDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {predictions?.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingUp className="mx-auto h-12 w-12 text-green-500" />
                  <h3 className="mt-2 text-lg font-medium">{t('capacity.noDelays')}</h3>
                  <p className="mt-1 text-muted-foreground">
                    {t('capacity.noDelaysDesc')}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('capacity.workOrder')}</TableHead>
                      <TableHead>{t('capacity.scheduledEnd')}</TableHead>
                      <TableHead>{t('capacity.predictedDelay')}</TableHead>
                      <TableHead>{t('capacity.reason')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {predictions?.map((pred) => (
                      <TableRow key={pred.work_order_id}>
                        <TableCell className="font-medium">{pred.work_order_number}</TableCell>
                        <TableCell>
                          {new Date(pred.scheduled_end).toLocaleDateString('en-US')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive">
                            +{pred.predicted_delay_hours} {t('capacity.hours')}
                          </Badge>
                        </TableCell>
                        <TableCell>{pred.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default CapacityDashboard
