import { useEffect, useState } from 'react'
import { TrendingUp, Percent, Gauge, Scale } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { getGlassClasses, getGradientTextClasses } from '@/lib/wardah-ui-utils'
import { fetchRealDashboardData, type DashboardData } from '@/services/dashboard-data-service'

/** هامش الشهر % من سلسلتَي إيراد/ربح حقيقيتين — null عند غياب إيراد (لا تلفيق). */
export function monthlyMargin(revenue: number, profit: number): number | null {
  if (revenue === 0) return null
  return (profit / revenue) * 100
}

/** مؤشرات أداء اللوحة: كفاءة/هوامش من البيانات الفعلية + جدول هوامش شهرية. */
export function DashboardPerformance() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        setData(await fetchRealDashboardData())
      } catch (err) {
        console.error('Error loading performance data:', err)
        setError(err instanceof Error ? err.message : 'حدث خطأ غير معروف')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">جاري تحميل مؤشرات الأداء...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <ErrorState
        title="تعذّر تحميل مؤشرات الأداء"
        message={error ?? 'لا توجد بيانات'}
        onRetry={() => globalThis.window.location.reload()}
      />
    )
  }

  const { kpis, charts } = data
  const tiles = [
    { title: 'كفاءة التشغيل', value: `${kpis.operationalEfficiency.toFixed(1)}%`, icon: Gauge },
    { title: 'هامش الربح', value: `${kpis.profitMargin.toFixed(1)}%`, icon: Percent },
    { title: 'مجمل الربح', value: formatCurrency(kpis.grossProfit), icon: TrendingUp },
    { title: 'صافي الربح', value: formatCurrency(kpis.netProfit), icon: Scale },
  ]

  return (
    <div className="space-y-6">
      <div className="text-right">
        <h1 className={`text-3xl font-bold ${getGradientTextClasses()}`}>مؤشرات الأداء</h1>
        <p className="text-muted-foreground mt-2">
          كفاءة وهوامش محسوبة من بيانات المؤسسة الفعلية
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <div key={tile.title} className={getGlassClasses()}>
              <div className="flex items-center justify-between p-6">
                <div className="text-right">
                  <p className="text-sm font-medium text-muted-foreground">{tile.title}</p>
                  <p className="text-2xl font-bold">{tile.value}</p>
                </div>
                <Icon className="h-8 w-8 text-primary" />
              </div>
            </div>
          )
        })}
      </div>

      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="text-right">هامش الربح الشهري</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الشهر</TableHead>
                  <TableHead className="text-left">المبيعات</TableHead>
                  <TableHead className="text-left">الربح</TableHead>
                  <TableHead className="text-left">الهامش</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charts.months.map((m, i) => {
                  const margin = monthlyMargin(charts.revenue[i], charts.profit[i])
                  return (
                    <TableRow key={m + i}>
                      <TableCell className="text-right">{m}</TableCell>
                      <TableCell className="text-left">{formatCurrency(charts.revenue[i])}</TableCell>
                      <TableCell className="text-left">{formatCurrency(charts.profit[i])}</TableCell>
                      <TableCell className="text-left font-medium">
                        {margin === null ? '—' : `${margin.toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default DashboardPerformance
