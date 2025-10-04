import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { 
  Factory, 
  Package, 
  DollarSign, 
  TrendingUp, 
  Users, 
  ShoppingCart,
  AlertTriangle,
  CheckCircle,
  Clock,
  BarChart3
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatNumber, cn } from '@/lib/utils'
import { getGlassClasses, getGradientTextClasses } from '@/lib/wardah-ui-utils'

// Sample KPI data - in a real app, this would come from an API
const kpiData = {
  totalInventoryValue: 188400,
  totalSalesThisMonth: 98000,
  totalProductionCost: 30600,
  grossProfitMargin: 36.7,
  inventoryTurnover: 2.4,
  activeManufacturingOrders: 2,
  pendingPurchaseOrders: 3,
  overdueInvoices: 0,
  totalCustomers: 15,
  totalSuppliers: 8,
  currentMonthProduction: 6500,
  processEfficiency: 85.6
}

const recentActivities = [
  {
    id: 1,
    type: 'success',
    title: 'أمر تصنيع مكتمل',
    description: 'تم إنجاز أمر التصنيع MO-2025-001 بنجاح',
    time: 'منذ ساعة',
    icon: CheckCircle
  },
  {
    id: 2,
    type: 'info',
    title: 'أمر شراء جديد',
    description: 'تم إنشاء أمر شراء PO-2025-004 للمواد الخام',
    time: 'منذ ساعتين',
    icon: ShoppingCart
  },
  {
    id: 3,
    type: 'warning',
    title: 'مخزون منخفض',
    description: 'مخزون الملونات الصناعية أقل من الحد الأدنى',
    time: 'منذ 3 ساعات',
    icon: AlertTriangle
  },
  {
    id: 4,
    type: 'info',
    title: 'فاتورة مبيعات',
    description: 'تم إصدار فاتورة مبيعات INV-2025-015',
    time: 'منذ 4 ساعات',
    icon: DollarSign
  }
]

export function DashboardOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className={cn("text-3xl font-bold", getGradientTextClasses())}>{t('dashboard.title')}</h1>
        <p className="text-muted-foreground mt-2">
          نظرة شاملة على أداء نظام وردة للتصنيع
        </p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Inventory Value */}
        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-6",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalInventoryValue')}
              </p>
              <p className="text-2xl font-bold">
                {formatCurrency(kpiData.totalInventoryValue)}
              </p>
            </div>
            <Package className="h-8 w-8 text-primary" />
          </div>
          <div className={cn(
            "px-6 pb-6 flex items-center text-sm",
            isRTL ? "flex-row-reverse" : "flex-row"
          )}>
            <TrendingUp className={cn(
              "h-4 w-4 text-success",
              isRTL ? "ml-1" : "mr-1"
            )} />
            <span className="text-success">+5.2%</span>
            <span className={cn(
              "text-muted-foreground",
              isRTL ? "ml-1" : "mr-1"
            )}>من الشهر الماضي</span>
          </div>
        </div>

        {/* Sales This Month */}
        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-6",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalSales')}
              </p>
              <p className="text-2xl font-bold">
                {formatCurrency(kpiData.totalSalesThisMonth)}
              </p>
            </div>
            <DollarSign className="h-8 w-8 text-success" />
          </div>
          <div className={cn(
            "px-6 pb-6 flex items-center text-sm",
            isRTL ? "flex-row-reverse" : "flex-row"
          )}>
            <TrendingUp className={cn(
              "h-4 w-4 text-success",
              isRTL ? "ml-1" : "mr-1"
            )} />
            <span className="text-success">+12.5%</span>
            <span className={cn(
              "text-muted-foreground",
              isRTL ? "ml-1" : "mr-1"
            )}>من الشهر الماضي</span>
          </div>
        </div>

        {/* Production Cost */}
        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-6",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalProductionCost')}
              </p>
              <p className="text-2xl font-bold">
                {formatCurrency(kpiData.totalProductionCost)}
              </p>
            </div>
            <Factory className="h-8 w-8 text-warning" />
          </div>
          <div className={cn(
            "px-6 pb-6 flex items-center text-sm",
            isRTL ? "text-right" : "text-left"
          )}>
            <span className="text-muted-foreground">
              كفاءة الإنتاج: {kpiData.processEfficiency}%
            </span>
          </div>
        </div>

        {/* Gross Profit Margin */}
        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-6",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.grossProfitMargin')}
              </p>
              <p className="text-2xl font-bold">
                {kpiData.grossProfitMargin}%
              </p>
            </div>
            <BarChart3 className="h-8 w-8 text-info" />
          </div>
          <div className={cn(
            "px-6 pb-6 flex items-center text-sm",
            isRTL ? "flex-row-reverse" : "flex-row"
          )}>
            <TrendingUp className={cn(
              "h-4 w-4 text-success",
              isRTL ? "ml-1" : "mr-1"
            )} />
            <span className="text-success">+2.1%</span>
            <span className={cn(
              "text-muted-foreground",
              isRTL ? "ml-1" : "mr-1"
            )}>من الشهر الماضي</span>
          </div>
        </div>
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-4",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">أوامر التصنيع النشطة</p>
              <p className="text-lg font-semibold">{kpiData.activeManufacturingOrders}</p>
            </div>
            <Badge {...{variant: "success"} as any}>{kpiData.activeManufacturingOrders}</Badge>
          </div>
        </div>

        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-4",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">أوامر الشراء المعلقة</p>
              <p className="text-lg font-semibold">{kpiData.pendingPurchaseOrders}</p>
            </div>
            <Badge {...{variant: "warning"} as any}>{kpiData.pendingPurchaseOrders}</Badge>
          </div>
        </div>

        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-4",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">الفواتير المتأخرة</p>
              <p className="text-lg font-semibold">{kpiData.overdueInvoices}</p>
            </div>
            <Badge {...{variant: "success"} as any}>{kpiData.overdueInvoices}</Badge>
          </div>
        </div>

        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-4",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">إجمالي العملاء</p>
              <p className="text-lg font-semibold">{kpiData.totalCustomers}</p>
            </div>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>

        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-4",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">إجمالي الموردين</p>
              <p className="text-lg font-semibold">{kpiData.totalSuppliers}</p>
            </div>
            <ShoppingCart className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>

        <div className={getGlassClasses()}>
          <div className={cn(
            "flex items-center justify-between p-4",
            isRTL && "flex-row-reverse"
          )}>
            <div className={cn(isRTL ? "text-right" : "text-left")}>
              <p className="text-xs text-muted-foreground">إنتاج الشهر</p>
              <p className="text-lg font-semibold">{formatNumber(kpiData.currentMonthProduction)}</p>
            </div>
            <Factory className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={getGlassClasses()}>
          <h3 className={cn(
            "text-lg font-semibold mb-4 p-6 pb-0",
            isRTL ? "text-right" : "text-left"
          )}>
            {t('dashboard.recentActivities')}
          </h3>
          <div className="space-y-4 p-6 pt-0">
            {recentActivities.map((activity) => {
              const Icon = activity.icon
              return (
                <div key={activity.id} className={cn(
                  "flex items-start gap-3",
                  isRTL && "flex-row-reverse"
                )}>
                  <div className={`p-2 rounded-full ${
                    activity.type === 'success' ? 'bg-success/10 text-success' :
                    activity.type === 'warning' ? 'bg-warning/10 text-warning' :
                    activity.type === 'info' ? 'bg-info/10 text-info' :
                    'bg-muted'
                  }`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className={cn(
                    "flex-1 min-w-0",
                    isRTL ? "text-right" : "text-left"
                  )}>
                    <p className="font-medium text-sm">{activity.title}</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      {activity.description}
                    </p>
                    <div className={cn(
                      "flex items-center gap-1 mt-2",
                      isRTL ? "flex-row-reverse justify-end" : "flex-row"
                    )}>
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {activity.time}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
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
            <Link to="/manufacturing/orders" className={cn(
              "p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center",
              isRTL ? "text-right" : "text-left"
            )}>
              <Factory className="h-6 w-6 mx-auto mb-2 text-primary" />
              <span className="text-sm font-medium">أمر تصنيع جديد</span>
            </Link>
            
            <Link to="/purchasing/orders" className={cn(
              "p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center",
              isRTL ? "text-right" : "text-left"
            )}>
              <ShoppingCart className="h-6 w-6 mx-auto mb-2 text-primary" />
              <span className="text-sm font-medium">أمر شراء جديد</span>
            </Link>
            
            <Link to="/sales/invoices" className={cn(
              "p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center",
              isRTL ? "text-right" : "text-left"
            )}>
              <DollarSign className="h-6 w-6 mx-auto mb-2 text-primary" />
              <span className="text-sm font-medium">فاتورة مبيعات</span>
            </Link>
            
            <Link to="/inventory/adjustments" className={cn(
              "p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center",
              isRTL ? "text-right" : "text-left"
            )}>
              <Package className="h-6 w-6 mx-auto mb-2 text-primary" />
              <span className="text-sm font-medium">تسوية مخزون</span>
            </Link>

            <Link to="/inventory/items" className={cn(
              "p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center",
              isRTL ? "text-right" : "text-left"
            )}>
              <Package className="h-6 w-6 mx-auto mb-2 text-success" />
              <span className="text-sm font-medium">إضافة صنف جديد</span>
            </Link>

            <Link to="/sales/customers" className={cn(
              "p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center",
              isRTL ? "text-right" : "text-left"
            )}>
              <Users className="h-6 w-6 mx-auto mb-2 text-info" />
              <span className="text-sm font-medium">عميل جديد</span>
            </Link>

            <Link to="/purchasing/suppliers" className={cn(
              "p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center",
              isRTL ? "text-right" : "text-left"
            )}>
              <ShoppingCart className="h-6 w-6 mx-auto mb-2 text-warning" />
              <span className="text-sm font-medium">مورد جديد</span>
            </Link>

            <Link to="/reports/analytics" className={cn(
              "p-4 rounded-lg border border-dashed border-muted-foreground/25 hover:border-primary hover:bg-primary/5 transition-colors text-center",
              isRTL ? "text-right" : "text-left"
            )}>
              <BarChart3 className="h-6 w-6 mx-auto mb-2 text-secondary" />
              <span className="text-sm font-medium">تقرير تحليلي</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}