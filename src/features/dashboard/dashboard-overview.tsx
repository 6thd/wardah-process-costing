import { useEffect, useState } from 'react'
import { LoadingSpinner } from '@/components/ui/loading-state'
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
  BarChart3,
  type LucideIcon,
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
import { usePermissions } from '@/hooks/usePermissions'

interface DashboardQuickAction {
  href: string
  label: string
  icon: LucideIcon
  iconClass: string
  permissionKey?: string
  moduleCode?: string
}

const DASHBOARD_QUICK_ACTIONS: DashboardQuickAction[] = [
  {
    href: '/manufacturing/orders',
    label: 'أمر تصنيع جديد',
    icon: Factory,
    iconClass: 'text-primary',
    permissionKey: 'manufacturing.orders.create',
  },
  {
    href: '/purchasing/orders',
    label: 'أمر شراء جديد',
    icon: ShoppingCart,
    iconClass: 'text-primary',
    permissionKey: 'purchasing.purchase_orders.create',
  },
  {
    href: '/sales/invoices',
    label: 'فاتورة مبيعات',
    icon: DollarSign,
    iconClass: 'text-primary',
    permissionKey: 'sales.sales_invoices.create',
  },
  {
    href: '/inventory/adjustments',
    label: 'تسوية مخزون',
    icon: Package,
    iconClass: 'text-primary',
    permissionKey: 'inventory.adjustments.create',
  },
  {
    href: '/inventory/items',
    label: 'إضافة صنف جديد',
    icon: Package,
    iconClass: 'text-success',
    permissionKey: 'inventory.items.create',
  },
  {
    href: '/sales/customers',
    label: 'عميل جديد',
    icon: Users,
    iconClass: 'text-info',
    permissionKey: 'sales.customers.create',
  },
  {
    href: '/purchasing/suppliers',
    label: 'مورد جديد',
    icon: ShoppingCart,
    iconClass: 'text-warning',
    permissionKey: 'purchasing.suppliers.create',
  },
  {
    href: '/reports/analytics',
    label: 'تقرير تحليلي',
    icon: BarChart3,
    iconClass: 'text-secondary',
    moduleCode: 'reports',
  },
]

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
  const { hasModuleAccess, hasPermissionKey } = usePermissions()
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
      <LoadingSpinner label="جاري تحميل لوحة التحكم..." />
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
  const canSeeManufacturing = hasModuleAccess('manufacturing')
  const canSeeInventory = hasModuleAccess('inventory')
  const canSeePurchasing = hasModuleAccess('purchasing')
  const canSeeSales = hasModuleAccess('sales')
  const canSeeAccounting = hasModuleAccess('accounting') || hasModuleAccess('general_ledger')
  const visibleQuickActions = DASHBOARD_QUICK_ACTIONS.filter(action => {
    if (action.permissionKey) return hasPermissionKey(action.permissionKey)
    if (action.moduleCode) return hasModuleAccess(action.moduleCode)
    return false
  })

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
        {canSeeInventory ? (
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
        ) : null}

        {/* Total Sales */}
        {canSeeSales ? (
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
        ) : null}

        {/* Total Costs */}
        {canSeeManufacturing ? (
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
        ) : null}

        {/* Profit Margin */}
        {canSeeAccounting && canSeeSales ? (
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
        ) : null}
      </div>

      {/* Secondary KPIs — عدّادات تشغيلية حقيقية */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {canSeeManufacturing ? <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-4", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">أوامر التصنيع النشطة</p>
              <p className="text-lg font-semibold">{counts?.activeManufacturingOrders ?? 0}</p>
            </div>
            <Badge {...{variant: "success"} as any}>{counts?.activeManufacturingOrders ?? 0}</Badge>
          </div>
        </div> : null}

        {canSeePurchasing ? <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-4", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">أوامر الشراء المعلقة</p>
              <p className="text-lg font-semibold">{counts?.pendingPurchaseOrders ?? 0}</p>
            </div>
            <Badge {...{variant: "warning"} as any}>{counts?.pendingPurchaseOrders ?? 0}</Badge>
          </div>
        </div> : null}

        {canSeeSales ? <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-4", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">إجمالي العملاء</p>
              <p className="text-lg font-semibold">{counts?.totalCustomers ?? 0}</p>
            </div>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
        </div> : null}

        {canSeePurchasing ? <div className={getGlassClasses()}>
          <div className={cn("flex items-center justify-between p-4", isRTL && "flex-row-reverse")}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">إجمالي الموردين</p>
              <p className="text-lg font-semibold">{counts?.totalVendors ?? 0}</p>
            </div>
            <ShoppingCart className="h-5 w-5 text-muted-foreground" />
          </div>
        </div> : null}
      </div>

      {/* Recent Activities + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {canSeeSales ? <div className={getGlassClasses()}>
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
        </div> : null}

        {/* Quick Actions */}
        {visibleQuickActions.length > 0 ? <div className={getGlassClasses()}>
          <h3 className={cn(
            "text-lg font-semibold mb-4 p-6 pb-0",
            isRTL ? "text-right" : "text-left"
          )}>
            {t('dashboard.quickActions')}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-6 pt-0">
            {visibleQuickActions.map(action => {
              const Icon = action.icon
              return (
                <Link
                  key={action.href}
                  to={action.href}
                  className="p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center"
                >
                  <Icon className={cn('h-6 w-6 mx-auto mb-2', action.iconClass)} />
                  <span className="text-sm font-medium">{action.label}</span>
                </Link>
              )
            })}
          </div>
        </div> : null}
      </div>
    </div>
  )
}
