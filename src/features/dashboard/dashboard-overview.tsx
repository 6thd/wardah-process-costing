import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Factory,
  Package,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  ShoppingCart,
  Clock,
  BarChart3
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/ui/error-state'
import { formatCurrency, cn } from '@/lib/utils'
import { getGlassClasses, getGradientTextClasses } from '@/lib/wardah-ui-utils'
import {
  fetchRealDashboardData,
  fetchOperationalCounts,
  type DashboardData,
  type OperationalCounts,
} from '@/services/dashboard-data-service'

interface RecentInvoice {
  id: string
  invoice_number: string
  total_amount: number
  invoice_date: string
  customer?: { name?: string } | null
}

/** نمو الشهر الحالي مقابل السابق من سلسلة شهرية حقيقية — null عند غياب أساس المقارنة. */
export function monthOverMonthGrowth(series: number[]): number | null {
  if (series.length < 2) return null
  const prev = series[series.length - 2]
  const curr = series[series.length - 1]
  if (prev === 0) return null // لا أساس مقارنة ⇒ لا نسبة (لا تلفيق)
  return ((curr - prev) / Math.abs(prev)) * 100
}

function TrendLine({ growth }: { readonly growth: number | null }) {
  if (growth === null) return null
  const positive = growth >= 0
  const Icon = positive ? TrendingUp : TrendingDown
  return (
    <div className="px-6 pb-6 flex items-center text-sm gap-1">
      <Icon className={cn('h-4 w-4', positive ? 'text-success' : 'text-destructive')} />
      <span className={positive ? 'text-success' : 'text-destructive'}>
        {positive ? '+' : ''}{growth.toFixed(1)}%
      </span>
      <span className="text-muted-foreground">من الشهر الماضي</span>
    </div>
  )
}

export function DashboardOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  const [data, setData] = useState<DashboardData | null>(null)
  const [counts, setCounts] = useState<OperationalCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const [d, c] = await Promise.all([fetchRealDashboardData(), fetchOperationalCounts()])
        setData(d)
        setCounts(c)
      } catch (err) {
        console.error('Error loading dashboard data:', err)
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
          <p className="mt-2 text-muted-foreground">جاري تحميل لوحة التحكم...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <ErrorState
        title="تعذّر تحميل لوحة التحكم"
        message={error ?? 'لا توجد بيانات'}
        onRetry={() => globalThis.window.location.reload()}
      />
    )
  }

  const { kpis, charts } = data
  const salesGrowth = monthOverMonthGrowth(charts.revenue)
  const profitSeries = charts.revenue.map((r, i) => r - charts.costs[i])
  const profitGrowth = monthOverMonthGrowth(profitSeries)
  const recentInvoices = (data.recentTransactions ?? []) as RecentInvoice[]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className={cn("text-3xl font-bold", getGradientTextClasses())}>{t('dashboard.title')}</h1>
        <p className="text-muted-foreground mt-2">
          نظرة شاملة على أداء نظام وردة للتصنيع — بيانات حية من قاعدة المؤسسة
        </p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Inventory Value */}
        <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-6", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalInventoryValue')}
              </p>
              <p className="text-2xl font-bold">{formatCurrency(kpis.inventoryValue)}</p>
            </div>
            <Package className="h-8 w-8 text-primary" />
          </div>
        </div>

        {/* Total Sales */}
        <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-6", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalSales')}
              </p>
              <p className="text-2xl font-bold">{formatCurrency(kpis.totalSales)}</p>
            </div>
            <DollarSign className="h-8 w-8 text-success" />
          </div>
          <TrendLine growth={salesGrowth} />
        </div>

        {/* Total Costs */}
        <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-6", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalProductionCost')}
              </p>
              <p className="text-2xl font-bold">{formatCurrency(kpis.totalCosts)}</p>
            </div>
            <Factory className="h-8 w-8 text-warning" />
          </div>
          <div className={cn("px-6 pb-6 flex items-center text-sm", isRTL ? "text-right" : "text-left")}>
            <span className="text-muted-foreground">
              كفاءة التشغيل: {kpis.operationalEfficiency.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Profit Margin */}
        <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-6", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.grossProfitMargin')}
              </p>
              <p className="text-2xl font-bold">{kpis.profitMargin.toFixed(1)}%</p>
            </div>
            <BarChart3 className="h-8 w-8 text-info" />
          </div>
          <TrendLine growth={profitGrowth} />
        </div>
      </div>

      {/* Secondary KPIs — عدّادات تشغيلية حقيقية */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-4", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">أوامر التصنيع النشطة</p>
              <p className="text-lg font-semibold">{counts?.activeManufacturingOrders ?? 0}</p>
            </div>
            <Badge {...{variant: "success"} as any}>{counts?.activeManufacturingOrders ?? 0}</Badge>
          </div>
        </div>

        <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-4", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">أوامر الشراء المعلقة</p>
              <p className="text-lg font-semibold">{counts?.pendingPurchaseOrders ?? 0}</p>
            </div>
            <Badge {...{variant: "warning"} as any}>{counts?.pendingPurchaseOrders ?? 0}</Badge>
          </div>
        </div>

        <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-4", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">إجمالي العملاء</p>
              <p className="text-lg font-semibold">{counts?.totalCustomers ?? 0}</p>
            </div>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>

        <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-4", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">إجمالي الموردين</p>
              <p className="text-lg font-semibold">{counts?.totalVendors ?? 0}</p>
            </div>
            <ShoppingCart className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* Recent Activities + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={getGlassClasses()}>
          <h3 className={cn(
            "text-lg font-semibold mb-4 p-6 pb-0",
            isRTL ? "text-right" : "text-left"
          )}>
            {t('dashboard.recentActivities')}
          </h3>
          <div className="space-y-4 p-6 pt-0">
            {recentInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد معاملات حديثة.</p>
            ) : (
              recentInvoices.map((inv) => (
                <div key={inv.id} className={cn("flex items-start gap-3", isRTL && "flex-row-reverse")}>
                  <div className="p-2 rounded-full bg-success/10 text-success">
                    <DollarSign className="h-4 w-4" />
                  </div>
                  <div className={cn("flex-1 min-w-0", isRTL ? "text-right" : "text-left")}>
                    <p className="font-medium text-sm">فاتورة مبيعات {inv.invoice_number}</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      {inv.customer?.name || 'عميل غير محدد'} — {formatCurrency(inv.total_amount || 0)}
                    </p>
                    <div className={cn(
                      "flex items-center gap-1 mt-2",
                      isRTL ? "flex-row-reverse justify-end" : "flex-row"
                    )}>
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-US') : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className={getGlassClasses()}>
          <h3 className={cn(
            "text-lg font-semibold mb-4 p-6 pb-0",
            isRTL ? "text-right" : "text-left"
          )}>
            {t('dashboard.quickActions')}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-6 pt-0">
            <Link to="/manufacturing/orders" className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center">
              <Factory className="h-6 w-6 mx-auto mb-2 text-primary" />
              <span className="text-sm font-medium">أمر تصنيع جديد</span>
            </Link>

            <Link to="/purchasing/orders" className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center">
              <ShoppingCart className="h-6 w-6 mx-auto mb-2 text-primary" />
              <span className="text-sm font-medium">أمر شراء جديد</span>
            </Link>

            <Link to="/sales/invoices" className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center">
              <DollarSign className="h-6 w-6 mx-auto mb-2 text-primary" />
              <span className="text-sm font-medium">فاتورة مبيعات</span>
            </Link>

            <Link to="/inventory/adjustments" className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center">
              <Package className="h-6 w-6 mx-auto mb-2 text-primary" />
              <span className="text-sm font-medium">تسوية مخزون</span>
            </Link>

            <Link to="/inventory/items" className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center">
              <Package className="h-6 w-6 mx-auto mb-2 text-success" />
              <span className="text-sm font-medium">إضافة صنف جديد</span>
            </Link>

            <Link to="/sales/customers" className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center">
              <Users className="h-6 w-6 mx-auto mb-2 text-info" />
              <span className="text-sm font-medium">عميل جديد</span>
            </Link>

            <Link to="/purchasing/suppliers" className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center">
              <ShoppingCart className="h-6 w-6 mx-auto mb-2 text-warning" />
              <span className="text-sm font-medium">مورد جديد</span>
            </Link>

            <Link to="/reports/analytics" className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center">
              <BarChart3 className="h-6 w-6 mx-auto mb-2 text-secondary" />
              <span className="text-sm font-medium">تقرير تحليلي</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
