import { useEffect, useRef, useState } from 'react'
import { LoadingSpinner } from '@/components/ui/loading-state'
import ApexCharts from 'apexcharts'
import { ErrorState } from '@/components/ui/error-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { getGradientTextClasses } from '@/lib/wardah-ui-utils'
import { fetchRealDashboardData, type DashboardData } from '@/services/dashboard-data-service'

/** تحليلات اللوحة: رسم شهري حقيقي (مبيعات/تكاليف/أرباح) + جدول تفصيلي. */
export function DashboardAnalytics() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstanceRef = useRef<ApexCharts | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        setData(await fetchRealDashboardData())
      } catch (err) {
        console.error('Error loading analytics data:', err)
        setError(err instanceof Error ? err.message : 'حدث خطأ غير معروف')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (!data || !chartRef.current) return

    const chart = new ApexCharts(chartRef.current, {
      chart: { type: 'line', height: 350, background: 'transparent' },
      series: [
        { name: 'المبيعات', data: data.charts.revenue },
        { name: 'التكاليف', data: data.charts.costs },
        { name: 'الأرباح', data: data.charts.profit },
      ],
      xaxis: { categories: data.charts.months },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#4285f4', '#ea4335', '#34a853'],
      tooltip: { theme: 'dark' },
    })
    chart.render()
    chartInstanceRef.current = chart

    return () => {
      chartInstanceRef.current?.destroy()
      chartInstanceRef.current = null
    }
  }, [data])

  if (loading) {
    return (
      <LoadingSpinner label="جاري تحميل التحليلات..." />
    )
  }

  if (error || !data) {
    return (
      <ErrorState
        title="تعذّر تحميل التحليلات"
        message={error ?? 'لا توجد بيانات'}
        onRetry={() => globalThis.window.location.reload()}
      />
    )
  }

  const { months, revenue, costs, profit } = data.charts

  return (
    <div className="space-y-6">
      <div className="text-right">
        <h1 className={`text-3xl font-bold ${getGradientTextClasses()}`}>تحليلات الأداء المالي</h1>
        <p className="text-muted-foreground mt-2">
          آخر ستة أشهر — من فواتير المبيعات وأوامر الشراء الفعلية
        </p>
      </div>

      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="text-right">الأداء الشهري</CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={chartRef} className="wardah-min-height-chart" />
        </CardContent>
      </Card>

      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="text-right">تفصيل شهري</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الشهر</TableHead>
                  <TableHead className="text-left">المبيعات</TableHead>
                  <TableHead className="text-left">التكاليف</TableHead>
                  <TableHead className="text-left">الربح</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m, i) => (
                  <TableRow key={m + i}>
                    <TableCell className="text-right">{m}</TableCell>
                    <TableCell className="text-left">{formatCurrency(revenue[i])}</TableCell>
                    <TableCell className="text-left">{formatCurrency(costs[i])}</TableCell>
                    <TableCell className={`text-left font-medium ${profit[i] >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatCurrency(profit[i])}
                    </TableCell>
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

export default DashboardAnalytics
