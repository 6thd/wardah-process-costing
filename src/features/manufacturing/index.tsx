import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { DatePickerWithRange } from '@/components/ui/date-range-picker'
import { DateRange } from 'react-day-picker'
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
import { BOMManagement, BOMBuilder } from './bom'
import type { ManufacturingOrder } from '@/lib/supabase'
import { supabase, getEffectiveTenantId } from '@/lib/supabase'
import { useWorkCenters, useCreateWorkCenter, type WorkCenter } from '@/hooks/useWorkCenters'

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
      <Route path="bom/new" element={<BOMBuilder />} />
      <Route path="bom/:bomId/edit" element={<BOMBuilder />} />
      <Route path="quality" element={<QualityControlManagement />} />
      <Route path="*" element={<Navigate to="overview" replace />} />
    </Routes>
  )
}

function ProcessCostingPage() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('manufacturing.processCostingPage.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.processCostingPage.subtitle')}
        </p>
      </div>

      <StageCostingPanel />
    </div>
  )
}

function EquivalentUnitsPage() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('manufacturing.equivalentUnitsPage.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.equivalentUnitsPage.subtitle')}
        </p>
      </div>

      <EquivalentUnitsDashboard />
    </div>
  )
}

function VarianceAlertsPage() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('manufacturing.varianceAlertsPage.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.varianceAlertsPage.subtitle')}
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
      } catch (error: any) {
        // Handle missing table gracefully
        if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
          console.warn('manufacturing_orders table not found, using empty array')
          setOrders([])
        } else {
          console.error('Error loading manufacturing orders:', error)
          toast.error(t('manufacturing.ordersPage.loadError'))
        }
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
          {t('manufacturing.overviewPage.subtitle')}
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
          <div className="text-2xl font-bold text-blue-600">{activeOrders.length}</div>
          <div className="text-sm text-muted-foreground">{t('manufacturing.overviewPage.metrics.active')}</div>
        </div>
        <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
          <div className="text-2xl font-bold text-green-600">{completedOrders.length}</div>
          <div className="text-sm text-muted-foreground">{t('manufacturing.overviewPage.metrics.completed')}</div>
        </div>
        <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
          <div className="text-2xl font-bold text-amber-600">{pendingOrders.length}</div>
          <div className="text-sm text-muted-foreground">{t('manufacturing.overviewPage.metrics.pending')}</div>
        </div>
        <div className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-4">
          <div className="text-2xl font-bold text-purple-600">85.6%</div>
          <div className="text-sm text-muted-foreground">{t('manufacturing.overviewPage.metrics.efficiency')}</div>
        </div>
      </div>

      {/* Manufacturing Functions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link to="/manufacturing/orders" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Factory className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.orders.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.orders.description')}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Badge variant="secondary">
              {t('manufacturing.overviewPage.cards.orders.activeBadge', { count: activeOrders.length })}
            </Badge>
            <Badge variant="outline">
              {t('manufacturing.overviewPage.cards.orders.totalBadge', { count: orders.length })}
            </Badge>
          </div>
        </Link>

        <Link to="/manufacturing/process-costing" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <BarChart3 className="h-6 w-6 text-success" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.processCosting.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.processCosting.description')}
          </p>
          <Badge variant="default" className="mt-3">
            {t('manufacturing.overviewPage.cards.processCosting.badge')}
          </Badge>
        </Link>

        <Link to="/manufacturing/workcenters" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Settings className="h-6 w-6 text-info" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.workCenters.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.workCenters.description')}
          </p>
        </Link>

        <Link to="/manufacturing/bom" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Package className="h-6 w-6 text-warning" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.bom.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.bom.description')}
          </p>
        </Link>

        <Link to="/manufacturing/quality" className="wardah-glass-card wardah-glass-card-hover p-6 transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <CheckCircle className="h-6 w-6 text-success" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.quality.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.quality.description')}
          </p>
        </Link>

        <div className="wardah-glass-card wardah-glass-card-hover p-6">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Users className="h-6 w-6 text-secondary" />
            <h3 className={cn("font-semibold wardah-text-gradient-google", isRTL ? "text-right" : "text-left")}>
              {t('manufacturing.overviewPage.cards.labor.title')}
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            {t('manufacturing.overviewPage.cards.labor.description')}
          </p>
          <Badge variant="outline" className="mt-3">
            {t('manufacturing.overviewPage.cards.labor.badge')}
          </Badge>
        </div>
      </div>

      {/* Recent Manufacturing Orders */}
      {!loading && (
        <div className="wardah-glass-card">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-semibold wardah-text-gradient-google">
              {t('manufacturing.overviewPage.latestOrders.title')}
            </h3>
            <Link to="/manufacturing/orders">
              <Button variant="outline" size="sm">
                {t('manufacturing.overviewPage.latestOrders.viewAll')}
              </Button>
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
                    {order.status === 'completed'
                      ? t('manufacturing.overviewPage.latestOrders.status.completed')
                      : order.status === 'in-progress'
                        ? t('manufacturing.overviewPage.latestOrders.status.inProgress')
                        : t('manufacturing.overviewPage.latestOrders.status.pending')}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {t('manufacturing.overviewPage.latestOrders.unitsLabel', { count: order.quantity })}
                  </span>
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
  const [products, setProducts] = useState<{ id: string; name: string; code?: string }[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [orderForm, setOrderForm] = useState({
    orderNumber: '',
    productId: '',
    quantity: '',
    startDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    notes: '',
    status: 'draft' as ManufacturingOrder['status']
  })
  const queryClient = useQueryClient()
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: undefined
  })

  useEffect(() => {
    loadOrders()
    loadProducts()
  }, [])

  useEffect(() => {
    setOrderForm((prev) => ({
      ...prev,
      startDate: dateRange?.from ? dateRange.from.toISOString().slice(0, 10) : '',
      dueDate: dateRange?.to ? dateRange.to.toISOString().slice(0, 10) : ''
    }))
  }, [dateRange])

  const loadOrders = async () => {
    try {
      const data = await manufacturingService.getAll()
      setOrders(data || [])
    } catch (error: any) {
      // Handle missing table gracefully
      if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
        console.warn('manufacturing_orders table not found, using empty array')
        setOrders([])
      } else {
        console.error('Error loading orders:', error)
        toast.error(t('manufacturing.ordersPage.loadError'))
      }
    } finally {
      setLoading(false)
    }
  }

  const loadProducts = async () => {
    try {
      setProductsLoading(true)
      const orgId = await getEffectiveTenantId()

      const mapProducts = (data: any[] | null | undefined) =>
        (data || []).map((item) => ({
          id: item.id,
          name: item.name || item.code || 'Unnamed product',
          code: item.code
        }))

      const buildProductQuery = () => {
        let query = supabase
          .from('products')
          .select('id, name, code, org_id')
          .order('name', { ascending: true })
          .limit(100)

        if (orgId) {
          query = query.eq('org_id', orgId)
        }

        return query
      }

      const buildItemsQuery = () => {
        let query = supabase
          .from('items')
          .select('id, name, code, org_id')
          .order('name', { ascending: true })
          .limit(100)

        if (orgId) {
          query = query.eq('org_id', orgId)
        }

        return query
      }

      let productData: any[] | null = null

      try {
        const { data, error } = await buildProductQuery()
        if (error && (error.code === 'PGRST205' || error.message?.includes('relation'))) {
          productData = null
        } else if (error) {
          throw error
        } else {
          productData = data || []
        }
      } catch (error: any) {
        if (error.code === 'PGRST205') {
          productData = null
        } else {
          throw error
        }
      }

      if (!productData || productData.length === 0) {
        const { data: itemsData, error: itemsError } = await buildItemsQuery()
        if (itemsError && itemsError.code !== 'PGRST205') {
          throw itemsError
        }
        productData = itemsData || []
      }

      setProducts(mapProducts(productData))
    } catch (error) {
      console.warn('Could not load products for manufacturing orders form', error)
      setProducts([])
    } finally {
      setProductsLoading(false)
    }
  }

  const orderStatusOptions: ManufacturingOrder['status'][] = [
    'draft',
    'confirmed',
    'pending',
    'in-progress',
    'completed'
  ]

  const statusTranslationMap: Record<ManufacturingOrder['status'], string> = {
    draft: 'draft',
    confirmed: 'confirmed',
    'in-progress': 'inProgress',
    completed: 'completed',
    pending: 'pending'
  }

  const getStatusLabel = (status: ManufacturingOrder['status']) =>
    t(`manufacturing.manufacturingOrder.status.${statusTranslationMap[status]}`)

  const getStatusBadgeVariant = (status: ManufacturingOrder['status']) => {
    switch (status) {
      case 'completed':
        return 'default'
      case 'in-progress':
      case 'confirmed':
        return 'secondary'
      case 'pending':
        return 'outline'
      default:
        return 'outline'
    }
  }

  const handleCreateOrder = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!orderForm.productId) {
      toast.error(t('manufacturing.ordersPage.form.productRequired'))
      return
    }

    try {
      setCreatingOrder(true)
      const orgId = await getEffectiveTenantId()
      if (!orgId) {
        toast.error(t('manufacturing.ordersPage.form.missingOrg'))
        return
      }

      await manufacturingService.create({
        org_id: orgId,
        order_number: orderForm.orderNumber.trim() || `MO-${Date.now()}`,
        product_id: orderForm.productId,
        item_id: orderForm.productId,
        quantity: Number(orderForm.quantity) || 0,
        status: orderForm.status,
        start_date: orderForm.startDate || null,
        due_date: orderForm.dueDate || null,
        notes: orderForm.notes || null
      } as any)

      toast.success(t('manufacturing.ordersPage.form.createSuccess'))
      setOrderForm({
        orderNumber: '',
        productId: '',
        quantity: '',
        startDate: new Date().toISOString().slice(0, 10),
        dueDate: '',
        notes: '',
        status: 'draft'
      })
      setShowAddForm(false)
      loadOrders()
    } catch (error) {
      console.error(error)
      toast.error(t('manufacturing.ordersPage.form.createError'))
    } finally {
      setCreatingOrder(false)
    }
  }

  const updateOrderStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ManufacturingOrder['status'] }) => {
      return await manufacturingService.updateStatus(id, status)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
      loadOrders()
    }
  })

  const handleStatusChange = async (orderId: string, status: ManufacturingOrder['status']) => {
    try {
      await updateOrderStatus.mutateAsync({ id: orderId, status })
      toast.success(t('manufacturing.ordersPage.statusUpdated'))
    } catch (error) {
      console.error(error)
      toast.error(t('manufacturing.ordersPage.statusUpdateFailed'))
    }
  }

  const formatDate = (value?: string | null) => {
    if (!value) return '—'
    try {
      return new Date(value).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')
    } catch {
      return value
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
          <h1 className="text-2xl font-bold">{t('manufacturing.ordersPage.title')}</h1>
          <p className="text-muted-foreground">{t('manufacturing.ordersPage.subtitle')}</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="h-4 w-4 mr-2" />
          {showAddForm ? t('common.cancel') : t('manufacturing.ordersPage.newOrder')}
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{orders.filter(o => o.status === 'in-progress').length}</div>
          <div className="text-sm text-muted-foreground">{t('manufacturing.ordersPage.stats.inProgress')}</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{orders.filter(o => o.status === 'completed').length}</div>
          <div className="text-sm text-muted-foreground">{t('manufacturing.ordersPage.stats.completed')}</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-amber-600">{orders.filter(o => o.status === 'draft').length}</div>
          <div className="text-sm text-muted-foreground">{t('manufacturing.ordersPage.stats.drafts')}</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-purple-600">{orders.length}</div>
          <div className="text-sm text-muted-foreground">{t('manufacturing.ordersPage.stats.total')}</div>
        </div>
      </div>

      {showAddForm && (
        <Card>
          <CardHeader>
            <h3 className="text-xl font-semibold">{t('manufacturing.ordersPage.form.sectionTitle')}</h3>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleCreateOrder}>
              <div>
                <Label className="mb-1 block">{t('manufacturing.ordersPage.form.orderNumber')}</Label>
                <Input
                  value={orderForm.orderNumber}
                  onChange={(e) =>
                    setOrderForm((prev) => ({ ...prev, orderNumber: e.target.value }))
                  }
                  placeholder="MO-0001"
                />
              </div>
              <div>
                <Label className="mb-1 block">{t('manufacturing.ordersPage.form.product')}</Label>
                <Select
                  value={orderForm.productId}
                  onValueChange={(value) =>
                    setOrderForm((prev) => ({ ...prev, productId: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        productsLoading
                          ? t('common.loading')
                          : t('manufacturing.ordersPage.form.productPlaceholder')
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {products.length === 0 ? (
                      <SelectItem value="__empty" disabled>
                        {productsLoading
                          ? t('common.loading')
                          : t('manufacturing.ordersPage.form.noProducts')}
                      </SelectItem>
                    ) : (
                      products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.code ? `${product.code} - ` : ''}
                          {product.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block">{t('manufacturing.ordersPage.form.quantity')}</Label>
                <Input
                  type="number"
                  min="0"
                  value={orderForm.quantity}
                  onChange={(e) =>
                    setOrderForm((prev) => ({ ...prev, quantity: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="mb-1 block">{t('manufacturing.ordersPage.form.status')}</Label>
                <Select
                  value={orderForm.status}
                  onValueChange={(value) =>
                    setOrderForm((prev) => ({
                      ...prev,
                      status: value as ManufacturingOrder['status']
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {orderStatusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {getStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block">{t('manufacturing.ordersPage.form.dateRange')}</Label>
                <DatePickerWithRange date={dateRange} setDate={setDateRange} />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block">{t('manufacturing.ordersPage.form.notes')}</Label>
                <Textarea
                  rows={3}
                  value={orderForm.notes}
                  onChange={(e) =>
                    setOrderForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" disabled={creatingOrder}>
                  {creatingOrder
                    ? t('manufacturing.ordersPage.form.creating')
                    : t('manufacturing.ordersPage.form.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">
            {t('manufacturing.ordersPage.listTitle', { count: orders.length })}
          </h3>
        </div>
        <div className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('manufacturing.manufacturingOrder.number')}</TableHead>
                <TableHead>{t('manufacturing.manufacturingOrder.product')}</TableHead>
                <TableHead>{t('manufacturing.manufacturingOrder.quantityToProduce')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('manufacturing.manufacturingOrder.plannedStart')}</TableHead>
                <TableHead>{t('manufacturing.manufacturingOrder.plannedEnd')}</TableHead>
                <TableHead className="text-right">
                  {t('manufacturing.ordersPage.notesColumn', { defaultValue: t('common.notes') })}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {t('messages.noDataFound')}
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.order_number || '—'}</TableCell>
                    <TableCell>
                      {((order as any).item?.name || (order as any).item?.product_name) ?? '—'}
                    </TableCell>
                    <TableCell>{order.quantity ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={getStatusBadgeVariant(order.status)}>
                          {getStatusLabel(order.status)}
                        </Badge>
                        <Select
                          value={order.status}
                          onValueChange={(value) =>
                            handleStatusChange(order.id, value as ManufacturingOrder['status'])
                          }
                          disabled={updateOrderStatus.isPending}
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {orderStatusOptions.map((status) => (
                              <SelectItem key={`${order.id}-${status}`} value={status}>
                                {getStatusLabel(status)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate((order as any).start_date)}</TableCell>
                    <TableCell>{formatDate((order as any).due_date)}</TableCell>
                    <TableCell className="text-right">{order.notes || '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

// Work Centers Management Component
function WorkCentersManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const queryClient = useQueryClient()
  const { data: workCenters = [], isLoading } = useWorkCenters()
  const createWorkCenter = useCreateWorkCenter()

  const updateWorkCenter = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<WorkCenter> }) => {
      const { error } = await supabase
        .from('work_centers')
        .update(updates)
        .eq('id', id)

      if (error) throw error
      return true
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-centers'] })
  })

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    name_ar: '',
    description: '',
    hourly_rate: ''
  })

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!formData.code || !formData.name) {
      toast.error(t('manufacturing.workCenters.messages.validation'))
      return
    }

    try {
      const orgId = await getEffectiveTenantId()
      if (!orgId) {
        toast.error(t('manufacturing.workCenters.messages.missingOrg'))
        return
      }

      await createWorkCenter.mutateAsync({
        org_id: orgId,
        code: formData.code.trim(),
        name: formData.name.trim(),
        name_ar: formData.name_ar.trim() || formData.name.trim(),
        description: formData.description.trim() || null,
        hourly_rate: Number(formData.hourly_rate) || 0,
        is_active: true
      })

      toast.success(t('manufacturing.workCenters.messages.createSuccess'))
      setFormData({
        code: '',
        name: '',
        name_ar: '',
        description: '',
        hourly_rate: ''
      })
    } catch (error) {
      console.error(error)
      toast.error(t('manufacturing.workCenters.messages.createError'))
    }
  }

  const toggleActive = async (workCenter: WorkCenter) => {
    try {
      await updateWorkCenter.mutateAsync({
        id: workCenter.id,
        updates: {
          is_active: !workCenter.is_active
        }
      })
      toast.success(t('manufacturing.workCenters.messages.updateSuccess'))
    } catch (error) {
      console.error(error)
      toast.error(t('manufacturing.workCenters.messages.updateError'))
    }
  }

  const activeCount = workCenters.filter((wc) => wc.is_active).length
  const avgRate = workCenters.length
    ? workCenters.reduce((sum, wc) => sum + (wc.hourly_rate || 0), 0) / workCenters.length
    : 0

  return (
    <div className="space-y-8">
      <div className={cn(isRTL ? 'text-right' : 'text-left')}>
        <h1 className="text-3xl font-bold">{t('manufacturing.workCenters.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.workCenters.subtitle')}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">
              {t('manufacturing.workCenters.metrics.total')}
            </p>
            <h3 className="text-3xl font-semibold">{workCenters.length}</h3>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">
              {t('manufacturing.workCenters.metrics.active')}
            </p>
            <h3 className="text-3xl font-semibold">{activeCount}</h3>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">
              {t('manufacturing.workCenters.metrics.avgRate')}
            </p>
            <h3 className="text-3xl font-semibold">{avgRate.toFixed(2)}</h3>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <h3 className="text-xl font-semibold">{t('manufacturing.workCenters.list.title')}</h3>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center text-muted-foreground py-10">
                {t('manufacturing.workCenters.list.loading')}
              </div>
            ) : workCenters.length === 0 ? (
              <div className="text-center text-muted-foreground py-10">
                {t('manufacturing.workCenters.list.empty')}
              </div>
            ) : (
              <div className="space-y-4">
                {workCenters.map((wc) => (
                  <div
                    key={wc.id}
                    className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between hover:bg-accent transition-colors"
                  >
                    <div>
                      <div className="font-semibold">
                        {wc.code} - {isRTL ? wc.name_ar || wc.name : wc.name}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {wc.description || t('manufacturing.workCenters.list.noDescription')}
                      </p>
                      <div className="text-xs text-muted-foreground mt-1">
                        {t('manufacturing.workCenters.list.hourlyRate', {
                          amount: wc.hourly_rate?.toFixed(2) || '0.00'
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm">
                        {wc.is_active
                          ? t('manufacturing.workCenters.list.statusActive')
                          : t('manufacturing.workCenters.list.statusInactive')}
                      </span>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                        <span>
                          {wc.is_active
                            ? t('manufacturing.workCenters.list.toggleDisable')
                            : t('manufacturing.workCenters.list.toggleEnable')}
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={wc.is_active}
                          onChange={() => toggleActive(wc)}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-xl font-semibold">{t('manufacturing.workCenters.form.title')}</h3>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label className="mb-1 block">{t('manufacturing.workCenters.form.code')} *</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
                />
              </div>
              <div>
                <Label className="mb-1 block">{t('manufacturing.workCenters.form.nameAr')}</Label>
                <Input
                  value={formData.name_ar}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name_ar: e.target.value }))}
                />
              </div>
              <div>
                <Label className="mb-1 block">{t('manufacturing.workCenters.form.nameEn')}</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <Label className="mb-1 block">{t('manufacturing.workCenters.form.description')}</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  rows={3}
                />
              </div>
              <div>
                <Label className="mb-1 block">{t('manufacturing.workCenters.form.hourlyRate')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.hourly_rate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, hourly_rate: e.target.value }))}
                />
              </div>
              <Button type="submit" className="w-full" disabled={createWorkCenter.isPending}>
                {createWorkCenter.isPending
                  ? t('manufacturing.workCenters.form.saving')
                  : t('manufacturing.workCenters.form.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Quality Control Management Component
function QualityControlManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('manufacturing.qualityControlPage.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.qualityControlPage.subtitle')}
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          {t('manufacturing.qualityControlPage.comingSoon')}
        </p>
      </div>
    </div>
  )
}
