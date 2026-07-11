import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VarianceAnalysisReport } from './components/VarianceAnalysisReport'
import { WIPReport } from './components/WIPReport'
import { useManufacturingOrders } from '@/features/manufacturing/hooks/useManufacturingOrders'
import { 
  BarChart3, 
  TrendingUp, 
  FileText, 
  Download, 
  DollarSign,
  Package,
  Factory,
  ShoppingCart,
  Eye,
  Calculator,
  Brain
} from 'lucide-react'
import { ProcessCostingReport } from './process-costing-report'
import { ProcessCostingDashboard } from './components/ProcessCostingDashboard'
import { ReportsDashboard } from './components/ReportsDashboard'
import GeminiDashboard from './components/GeminiDashboard'
import { EnhancedGeminiDashboard } from './components/EnhancedGeminiDashboard'
import { SalesReports as SalesReportsComponent } from './components/SalesReports'
import { InventoryValuationReport } from './components/InventoryValuationReport'
import { FinancialStatementsReport } from './components/FinancialStatementsReport'
import { PurchasingAnalyticsReport } from './components/PurchasingAnalyticsReport'

export function ReportsModule() {
  return (
    <Routes>
      <Route path="/" element={<ReportsOverview />} />
      <Route path="/financial" element={<FinancialReports />} />
      <Route path="/inventory" element={<InventoryReports />} />
      <Route path="/manufacturing" element={<ManufacturingReports />} />
      <Route path="/process-costing" element={<ProcessCostingReportPage />} />
      <Route path="/process-costing-dashboard" element={<ProcessCostingDashboardPage />} />
      <Route path="/sales" element={<SalesReports />} />
      <Route path="/purchasing" element={<PurchasingReports />} />
      <Route path="/analytics" element={<AdvancedAnalytics />} />
      <Route path="/advanced" element={<ReportsDashboard />} />
      <Route path="/gemini" element={<EnhancedGeminiDashboard />} />
      <Route path="/gemini/legacy" element={<GeminiDashboard />} />
      <Route path="*" element={<Navigate to="/reports" replace />} />
    </Routes>
  )
}

function ReportsOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  // Helper function to get badge variant based on status
  const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' => {
    if (status === 'مكتمل') {
      return 'default'
    }
    if (status === 'جاري') {
      return 'secondary'
    }
    return 'destructive'
  }
  
  const reportCategories = [
    {
      title: 'التقارير المالية',
      description: 'تقارير شاملة عن الوضع المالي',
      icon: DollarSign,
      href: '/reports/financial',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      reports: ['قائمة الدخل', 'الميزانية العمومية', 'التدفقات النقدية']
    },
    {
      title: 'تقارير المخزون',
      description: 'تقييم وحركة المخزون',
      icon: Package,
      href: '/reports/inventory',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      reports: ['تقييم المخزون', 'كارت الأصناف', 'الأصناف بطيئة الحركة']
    },
    {
      title: 'تقارير التصنيع',
      description: 'أداء وتكاليف الإنتاج',
      icon: Factory,
      href: '/reports/manufacturing',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      reports: ['تكاليف الإنتاج', 'كفاءة العمليات', 'تحليل المراحل']
    },
    {
      title: 'لوحة تكاليف المراحل',
      description: 'تحليل شامل لتكاليف المراحل مع EUP و Scrap',
      icon: Calculator,
      href: '/reports/process-costing-dashboard',
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      reports: ['حساب EUP', 'تحليل الهالك', 'مقارنة FIFO', 'تفصيل المراحل', 'تقييم WIP']
    },
    {
      title: 'تقارير المبيعات',
      description: 'أداء المبيعات والعملاء',
      icon: TrendingUp,
      href: '/reports/sales',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      reports: ['أداء المبيعات', 'تحليل العملاء', 'المنتجات الأكثر مبيعاً']
    },
    {
      title: 'تقارير المشتريات',
      description: 'أداء المشتريات والموردين',
      icon: ShoppingCart,
      href: '/reports/purchasing',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      reports: ['أداء الموردين', 'تحليل المشتريات', 'معدلات التسليم']
    },
    {
      title: 'التحليلات المتقدمة',
      description: 'تحليلات ورؤى متقدمة',
      icon: BarChart3,
      href: '/reports/analytics',
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      reports: ['الذكاء الاصطناعي', 'التنبؤات', 'الاتجاهات']
    },
    {
      title: 'التقارير المتقدمة',
      description: 'تقارير انحرافات وتقييم WIP',
      icon: Calculator,
      href: '/reports/advanced',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      reports: ['تحليل الانحرافات', 'تقرير WIP', 'تحليل الربحية']
    },
    {
      title: 'لوحة معلومات Gemini',
      description: 'تحليل مالي مدعوم بالذكاء الاصطناعي',
      icon: Brain,
      href: '/reports/gemini',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      reports: ['تحليل الأداء', 'التوقعات الذكية', 'التوصيات']
    }
  ]
  
  return (
    <div className="space-y-8">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('reports.title')}</h1>
        <p className="text-muted-foreground mt-2">
          تقارير وتحليلات شاملة لعمليات الشركة
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">25</div>
          <div className="text-sm text-muted-foreground">التقارير المتاحة</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">145</div>
          <div className="text-sm text-muted-foreground">تقرير منجز هذا الشهر</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-purple-600">12</div>
          <div className="text-sm text-muted-foreground">تقارير مجدولة</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-orange-600">7</div>
          <div className="text-sm text-muted-foreground">فئات التقارير</div>
        </div>
      </div>

      {/* Report Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reportCategories.map((category) => {
          const Icon = category.icon
          return (
            <Link key={category.href} to={category.href} className="bg-card rounded-lg border hover:shadow-md transition-all duration-200">
              <div className="p-6">
                <div className={cn("flex items-center gap-3 mb-4", isRTL ? "flex-row-reverse" : "")}>
                  <div className={cn("p-2 rounded-lg", category.bgColor)}>
                    <Icon className={cn("h-6 w-6", category.color)} />
                  </div>
                  <h3 className={cn("font-semibold text-lg", isRTL ? "text-right" : "text-left")}>
                    {category.title}
                  </h3>
                </div>
                <p className={cn("text-muted-foreground text-sm mb-4", isRTL ? "text-right" : "text-left")}>
                  {category.description}
                </p>
                <div className="space-y-1">
                  {category.reports.map((report) => (
                    <div key={report} className={cn("flex items-center gap-2 text-xs text-muted-foreground", isRTL ? "flex-row-reverse" : "")}>
                      <FileText className="h-3 w-3" />
                      <span>{report}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Recent Reports */}
      <div className="bg-card rounded-lg border">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">أحدث التقارير</h3>
        </div>
        <div className="divide-y">
          {[
            { name: 'تقرير المبيعات الشهرية', type: 'مبيعات', date: 'منذ يومين', status: 'مكتمل' },
            { name: 'تقييم المخزون', type: 'مخزون', date: 'منذ 3 أيام', status: 'جاري' },
            { name: 'تحليل تكاليف الإنتاج', type: 'تصنيع', date: 'منذ أسبوع', status: 'مكتمل' },
            { name: 'تحليل الانحرافات', type: 'متقدم', date: 'اليوم', status: 'جديد' }
          ].map((report) => {
            return (
            <div key={`${report.name}-${report.date}`} className="p-4 flex justify-between items-center hover:bg-accent/50 transition-colors">
              <div className="flex-1">
                <h4 className="font-medium">{report.name}</h4>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline">{report.type}</Badge>
                  <span className="text-sm text-muted-foreground">{report.date}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={getStatusVariant(report.status)}>
                  {report.status}
                </Badge>
                <Button variant="ghost" size="sm">
                  <Eye className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Financial Reports Component — قوائم مالية من أرصدة GL الفعلية (P11-4)
function FinancialReports() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">التقارير المالية</h1>
        <p className="text-muted-foreground mt-2">
          قائمة الدخل وملخص الميزانية من أرصدة دفتر الأستاذ الفعلية
        </p>
      </div>

      {/* روابط للتقارير المحاسبية الكاملة */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link to="/accounting/trial-balance" className="bg-card rounded-lg border p-4 hover:bg-accent transition-colors">
          <h3 className="font-semibold">ميزان المراجعة</h3>
          <p className="text-sm text-muted-foreground mt-1">أرصدة كل الحسابات مع تصدير Excel/PDF</p>
        </Link>
        <Link to="/accounting/account-statement" className="bg-card rounded-lg border p-4 hover:bg-accent transition-colors">
          <h3 className="font-semibold">كشف حساب</h3>
          <p className="text-sm text-muted-foreground mt-1">حركات حساب محدد بفترة زمنية</p>
        </Link>
      </div>

      <FinancialStatementsReport />
    </div>
  )
}

// Inventory Reports Component — تقرير تقييم المخزون الحقيقي (products المجمّع المرجعي)
function InventoryReports() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تقارير المخزون</h1>
        <p className="text-muted-foreground mt-2">
          تقييم وحركة وأداء المخزون
        </p>
      </div>
      <InventoryValuationReport />
    </div>
  )
}

// Manufacturing Reports Component — يجمع تقارير التصنيع الحقيقية القائمة (P11-2)
function ManufacturingReports() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [selectedMO, setSelectedMO] = useState('')
  const { orders: manufacturingOrders, loading: moLoading } = useManufacturingOrders()

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تقارير التصنيع</h1>
        <p className="text-muted-foreground mt-2">
          أداء وتكاليف وكفاءة عمليات الإنتاج
        </p>
      </div>

      {/* روابط سريعة للتقارير الكاملة القائمة */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/manufacturing/cost-of-production" className="bg-card rounded-lg border p-4 hover:bg-accent transition-colors">
          <h3 className="font-semibold">تقرير تكلفة الإنتاج</h3>
          <p className="text-sm text-muted-foreground mt-1">الوحدات المكافئة وتكلفة المراحل (قابل للطباعة)</p>
        </Link>
        <Link to="/reports/process-costing-dashboard" className="bg-card rounded-lg border p-4 hover:bg-accent transition-colors">
          <h3 className="font-semibold">لوحة تكاليف المراحل</h3>
          <p className="text-sm text-muted-foreground mt-1">EUP، الخردة، تقييم WIP، توزيع التكاليف</p>
        </Link>
        <Link to="/manufacturing/variance-alerts" className="bg-card rounded-lg border p-4 hover:bg-accent transition-colors">
          <h3 className="font-semibold">تنبيهات الانحرافات</h3>
          <p className="text-sm text-muted-foreground mt-1">انحرافات التكلفة الفعلية عن القياسية</p>
        </Link>
      </div>

      {/* تحليل الانحرافات لأمر تصنيع محدد + تقرير WIP */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="text-right">تحليل انحرافات أمر تصنيع</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="w-full md:w-64">
            <label htmlFor="mfg-report-mo" className="block text-sm font-medium mb-1 text-right">اختر أمر التصنيع</label>
            <Select value={selectedMO} onValueChange={setSelectedMO} disabled={moLoading}>
              <SelectTrigger id="mfg-report-mo" className="text-right">
                <SelectValue placeholder={moLoading ? 'جارٍ التحميل…' : 'اختر أمر التصنيع'} />
              </SelectTrigger>
              <SelectContent>
                {manufacturingOrders.map((mo) => (
                  <SelectItem key={mo.id} value={mo.id} className="text-right">
                    {mo.order_number ?? mo.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <VarianceAnalysisReport manufacturingOrderId={selectedMO} />
        </CardContent>
      </Card>

      <WIPReport />
    </div>
  )
}

function ProcessCostingReportPage() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تقرير تكاليف المراحل</h1>
        <p className="text-muted-foreground mt-2">
          تحليل تكاليف المراحل مع حساب الوحدات المكافئة
        </p>
      </div>

      <ProcessCostingReport />
    </div>
  )
}

function ProcessCostingDashboardPage() {
  return <ProcessCostingDashboard />
}

// Sales Reports Component - Now uses the comprehensive SalesReportsComponent
function SalesReports() {
  return <SalesReportsComponent />
}

// Purchasing Reports Component
function PurchasingReports() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تقارير المشتريات</h1>
        <p className="text-muted-foreground mt-2">
          أداء المشتريات وتحليل الموردين من البيانات الفعلية
        </p>
      </div>
      <PurchasingAnalyticsReport />
    </div>
  )
}

// Advanced Analytics Component — لوحة التحليلات الحقيقية (P11-2)
function AdvancedAnalytics() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">التحليلات المتقدمة</h1>
        <p className="text-muted-foreground mt-2">
          مؤشرات ورسوم مالية حية من بيانات المؤسسة الفعلية
        </p>
      </div>
      <EnhancedGeminiDashboard />
    </div>
  )
}