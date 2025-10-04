import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { manufacturingService } from '@/services/supabase-service'
import { toast } from 'sonner'
import { 
  Factory, 
  Settings, 
  Package, 
  Users, 
  BarChart3, 
  CheckCircle, 
  Plus
} from 'lucide-react'
import StageCostingPanel from './stage-costing-panel.tsx'
import { EquivalentUnitsDashboard } from './equivalent-units-dashboard'
import { VarianceAlerts } from './variance-alerts'
import type { ManufacturingOrder } from '@/lib/supabase'

export function ManufacturingModule() {
  return (
    <Routes>
      <Route index element={<ManufacturingOverview />} />
      <Route path="overview" element={<ManufacturingOverview />} />
      <Route path="orders" element={<ManufacturingOrdersManagement />} />
      <Route path="process-costing" element={<ProcessCostingPage />} />
      <Route path="equivalent-units" element={<EquivalentUnitsPage />} />
      <Route path="variance-alerts" element={<VarianceAlertsPage />} />
      <Route path="workcenters" element={<WorkCentersManagement />} />
      <Route path="bom" element={<BOMManagement />} />
      <Route path="quality" element={<QualityControlManagement />} />
      <Route path="*" element={<Navigate to="overview" replace />} />
    </Routes>
  )
}

function ProcessCostingPage() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تكاليف المراحل (Process Costing)</h1>
        <p className="text-muted-foreground mt-2">
          نظام متقدم لاحتساب تكاليف مراحل التصنيع
        </p>
      </div>

      <StageCostingPanel />
    </div>
  )
}

function EquivalentUnitsPage() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">الوحدات المكافئة</h1>
        <p className="text-muted-foreground mt-2">
          حساب الوحدات المكافئة وتحليل التكاليف
        </p>
      </div>

      <EquivalentUnitsDashboard />
    </div>
  )
}

function VarianceAlertsPage() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تنبيهات الانحرافات</h1>
        <p className="text-muted-foreground mt-2">
          مراقبة الانحرافات في التكاليف واتخاذ الإجراءات التصحيحية
        </p>
      </div>

      <VarianceAlerts />
    </div>
  )
}

function ManufacturingOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [orders, setOrders] = useState<ManufacturingOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadOrders = async () => {
      try {
        const data = await manufacturingService.getAll()
        setOrders(data || [])
      } catch (error) {
        console.error('Error loading manufacturing orders:', error)
        toast.error('خطأ في تحميل أوامر التصنيع')
      } finally {
        setLoading(false)
      }
    }
    loadOrders()
  }, [])

  const activeOrders = orders.filter(order => order.status === 'in-progress' || order.status === 'confirmed')
  const completedOrders = orders.filter(order => order.status === 'completed')
  const pendingOrders = orders.filter(order => order.status === 'draft')

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold wardah-text-gradient-google">{t('manufacturing.title')}</h1>
        <p className="text-muted-foreground mt-2">
          إدارة عمليات التصنيع وتكاليف المراحل
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
          <div className="text-2xl font-bold text-blue-600">{activeOrders.length}</div>
          <div className="text-sm text-muted-foreground">أوامر نشطة</div>
        </div>
        <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
          <div className="text-2xl font-bold text-green-600">{completedOrders.length}</div>
          <div className="text-sm text-muted-foreground">أوامر مكتملة</div>
        </div>
        <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
          <div className="text-2xl font-bold text-amber-600">{pendingOrders.length}</div>
          <div className="text-sm text-muted-foreground">في الانتظار</div>
        </div>
        <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
          <div className="text-2xl font-bold text-purple-600">85.6%</div>
          <div className="text-sm text-muted-foreground">كفاءة الإنتاج</div>
        </div>
      </div>

      {/* Manufacturing Functions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link to="/manufacturing/orders" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Factory className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              أوامر التصنيع
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إنشاء ومتابعة أوامر التصنيع
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Badge variant="secondary">{activeOrders.length} نشط</Badge>
            <Badge variant="outline">{orders.length} إجمالي</Badge>
          </div>
        </Link>

        <Link to="/manufacturing/process-costing" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <BarChart3 className="h-6 w-6 text-success" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              تكاليف المراحل
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            نظام متقدم لاحتساب تكاليف مراحل التصنيع
          </p>
          <Badge variant="default" className="mt-3">متقدم</Badge>
        </Link>

        <Link to="/manufacturing/workcenters" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Settings className="h-6 w-6 text-info" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              مراكز العمل
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إدارة مراكز العمل والآلات
          </p>
        </Link>

        <Link to="/manufacturing/bom" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Package className="h-6 w-6 text-warning" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              قوائم المواد (BOM)
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            قوائم المواد المطلوبة للتصنيع
          </p>
        </Link>

        <Link to="/manufacturing/quality" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <CheckCircle className="h-6 w-6 text-success" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              ضبط الجودة
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            فحص وضبط جودة المنتجات
          </p>
        </Link>

        <div className="wardah-glass-card wardah-glass-card-hover p-6">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Users className="h-6 w-6 text-secondary" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              إدارة العمالة
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            تسجيل أوقات العمل والحضور
          </p>
          <Badge variant="outline" className="mt-3">قريباً</Badge>
        </div>
      </div>

      {/* Recent Manufacturing Orders */}
      {!loading && (
        <div className="wardah-glass-card">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-semibold wardah-text-gradient-google">أحدث أوامر التصنيع</h3>
            <Link to="/manufacturing/orders">
              <Button variant="outline" size="sm">عرض الكل</Button>
            </Link>
          </div>
          <div className="divide-y">
            {orders.slice(0, 5).map((order) => (
              <div key={order.id} className="p-4 flex justify-between items-center">
                <div>
                  <h4 className="font-medium">{order.order_number}</h4>
                  <p className="text-sm text-muted-foreground">{order.product_name}</p>
                </div>
                <div className="text-right flex items-center gap-2">
                  <Badge 
                    variant={order.status === 'completed' ? 'default' : 
                            order.status === 'in-progress' ? 'secondary' : 'outline'}
                  >
                    {order.status === 'completed' ? 'مكتمل' : 
                     order.status === 'in-progress' ? 'جاري' : 'في الانتظار'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{order.quantity} وحدة</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Manufacturing Orders Management Component
function ManufacturingOrdersManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [orders, setOrders] = useState<ManufacturingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => {
    loadOrders()
  }, [])

  const loadOrders = async () => {
    try {
      const data = await manufacturingService.getAll()
      setOrders(data || [])
    } catch (error) {
      console.error('Error loading orders:', error)
      toast.error('خطأ في تحميل أوامر التصنيع')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold">أوامر التصنيع</h1>
          <p className="text-muted-foreground">إدارة أوامر التصنيع</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="h-4 w-4 mr-2" />
          {showAddForm ? t('common.cancel') : 'أمر جديد'}
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{orders.filter(o => o.status === 'in-progress').length}</div>
          <div className="text-sm text-muted-foreground">جارية</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{orders.filter(o => o.status === 'completed').length}</div>
          <div className="text-sm text-muted-foreground">مكتملة</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-amber-600">{orders.filter(o => o.status === 'draft').length}</div>
          <div className="text-sm text-muted-foreground">مسودات</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-purple-600">{orders.length}</div>
          <div className="text-sm text-muted-foreground">إجمالي</div>
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة أوامر التصنيع ({orders.length})</h3>
        </div>
        <div className="p-4">
          <p className="text-muted-foreground">قريباً - قائمة مفصلة بأوامر التصنيع</p>
        </div>
      </div>
    </div>
  )
}

// Work Centers Management Component
function WorkCentersManagement() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">مراكز العمل</h1>
        <p className="text-muted-foreground mt-2">
          إدارة مراكز العمل والآلات
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - إدارة مراكز العمل وقدرات الآلات
        </p>
      </div>
    </div>
  )
}

// BOM Management Component
function BOMManagement() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">قوائم المواد (BOM)</h1>
        <p className="text-muted-foreground mt-2">
          قوائم المواد المطلوبة للتصنيع
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - قوائم المواد والكميات المطلوبة
        </p>
      </div>
    </div>
  )
}

// Quality Control Management Component
function QualityControlManagement() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">ضبط الجودة</h1>
        <p className="text-muted-foreground mt-2">
          فحص وضبط جودة المنتجات
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - نظام فحص وضبط الجودة
        </p>
      </div>
    </div>
  )
}
