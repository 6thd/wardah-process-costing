import { Routes, Route, Navigate } from 'react-router-dom'
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
import { DateRange } from 'react-day-picker'
import { manufacturingService } from '@/services/supabase-service'
import { toast } from 'sonner'
import { useManufacturingOrders } from './hooks/useManufacturingOrders'
import { useManufacturingProducts } from './hooks/useManufacturingProducts'
import { createManufacturingOrder, getOrderDetails } from './services/manufacturingOrderService'
import { getStatusLabel, getStatusBadgeVariant, getStatusOptions, validateStatusTransition, prepareStatusUpdate } from './utils/statusHelpers'
import {
  Plus,
  Eye
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  getStatusInfo,
  isValidStatusTransition,
  type ManufacturingOrderStatus
} from '@/utils/manufacturing-order-status'
import StageCostingPanel from './stage-costing-panel.tsx'
import { EquivalentUnitsDashboard } from './equivalent-units-dashboard'
import { VarianceAlerts } from './variance-alerts'
import { BOMManagement, BOMBuilder } from './bom'
import { ManufacturingStagesList } from './manufacturing-stages-list'
import { StageWipLogList } from './stage-wip-log-list'
import { StandardCostsList } from './standard-costs-list'
import { ManufacturingOrderForm, ManufacturingQuickStats } from './components'
import { supabase, getEffectiveTenantId, type ManufacturingOrder } from '@/lib/supabase'
import { ManufacturingMetrics } from './components/ManufacturingMetrics'
import { ManufacturingCards } from './components/ManufacturingCards'
import { RecentOrders } from './components/RecentOrders'
// New modules
import { RoutingManagement } from './routing/RoutingManagement'
import { WorkCenterDashboard } from './mes/WorkCenterDashboard'
import { CapacityDashboard } from './capacity/CapacityDashboard'
import { EfficiencyDashboard } from './efficiency/EfficiencyDashboard'

// Extended types for order with related data
interface ManufacturingOrderWithItem extends ManufacturingOrder {
  item?: {
    name?: string
    code?: string
    product_name?: string
  }
  start_date?: string | null
  due_date?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface StatusUpdateData extends Record<string, unknown> {
  quantity?: number
  start_date?: string | null
  due_date?: string | null
}
import { useWorkCenters, useCreateWorkCenter, type WorkCenter } from '@/hooks/useWorkCenters'

export function ManufacturingModule() {
  return (
    <Routes>
      <Route index element={<ManufacturingOverview />} />
      <Route path="overview" element={<ManufacturingOverview />} />
      <Route path="orders" element={<ManufacturingOrdersManagement />} />
      <Route path="mes" element={<WorkCenterDashboard />} />
      <Route path="routing/*" element={<RoutingManagement />} />
      <Route path="capacity" element={<CapacityDashboard />} />
      <Route path="efficiency" element={<EfficiencyDashboard />} />
      <Route path="process-costing" element={<ProcessCostingPage />} />
      <Route path="equivalent-units" element={<EquivalentUnitsPage />} />
      <Route path="variance-alerts" element={<VarianceAlertsPage />} />
      <Route path="workcenters" element={<WorkCentersManagement />} />
      <Route path="stages" element={<ManufacturingStagesPage />} />
      <Route path="wip-log" element={<StageWipLogPage />} />
      <Route path="standard-costs" element={<StandardCostsPage />} />
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

function ManufacturingStagesPage() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold wardah-text-gradient-google">
          {t('manufacturing.stagesPage.title', { defaultValue: 'مراحل التصنيع' })}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.stagesPage.subtitle', { defaultValue: 'إدارة مراحل التصنيع وخطوات الإنتاج' })}
        </p>
      </div>

      <ManufacturingStagesList />
    </div>
  )
}

function StageWipLogPage() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold wardah-text-gradient-google">
          {t('manufacturing.wipLogPage.title', { defaultValue: 'سجلات العمل قيد التنفيذ (WIP)' })}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.wipLogPage.subtitle', { defaultValue: 'تتبع ومراقبة العمل قيد التنفيذ لكل مرحلة تصنيع' })}
        </p>
      </div>

      <StageWipLogList />
    </div>
  )
}

function StandardCostsPage() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold wardah-text-gradient-google">
          {t('manufacturing.standardCostsPage.title', { defaultValue: 'التكاليف القياسية' })}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.standardCostsPage.subtitle', { defaultValue: 'إدارة التكاليف القياسية للمنتجات والمراحل لتحليل الانحرافات' })}
        </p>
      </div>

      <StandardCostsList />
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
        // Convert OrderWithItem[] to ManufacturingOrder[] via unknown
        const ordersData = (data || []) as unknown as ManufacturingOrder[]
        setOrders(ordersData)
      } catch (error: unknown) {
        // Handle missing table gracefully
        const err = error as { code?: string; message?: string }
        if (err.code === 'PGRST205' || err.message?.includes('Could not find the table')) {
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
  }, [t])

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold wardah-text-gradient-google">{t('manufacturing.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('manufacturing.overviewPage.subtitle')}
        </p>
      </div>

      {/* Key Metrics */}
      <ManufacturingMetrics orders={orders} isRTL={isRTL} t={t} />

      {/* Manufacturing Functions Grid */}
      <ManufacturingCards orders={orders} isRTL={isRTL} t={t} />

      {/* Recent Manufacturing Orders */}
      <RecentOrders orders={orders} loading={loading} isRTL={isRTL} t={t} />
    </div>
  )
}

// Manufacturing Orders Management Component
function ManufacturingOrdersManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<ManufacturingOrder | null>(null)
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(false)
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false)
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

  const { orders, loading, loadOrders } = useManufacturingOrders()
  const { products, loading: productsLoading } = useManufacturingProducts()

  useEffect(() => {
    setOrderForm((prev) => ({
      ...prev,
      startDate: dateRange?.from ? dateRange.from.toISOString().slice(0, 10) : '',
      dueDate: dateRange?.to ? dateRange.to.toISOString().slice(0, 10) : ''
    }))
  }, [dateRange])

  const handleCreateOrder = async (event: React.FormEvent) => {
    event.preventDefault()

    setCreatingOrder(true)
    const success = await createManufacturingOrder(orderForm, t)
    
    if (success) {
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
    }
    
    setCreatingOrder(false)
  }

  const updateOrderStatus = useMutation({
    mutationFn: async ({ id, status, updateData }: { id: string; status: ManufacturingOrder['status']; updateData?: StatusUpdateData }) => {
      return await manufacturingService.updateStatus(id, status, updateData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
      loadOrders()
    }
  })

  const handleStatusChange = async (orderId: string, newStatus: ManufacturingOrder['status']) => {
    try {
      const currentOrder = orders.find(o => o.id === orderId)
      if (!currentOrder) {
        toast.error(isRTL ? 'الطلب غير موجود' : 'Order not found')
        return
      }

      const currentStatus = currentOrder.status as ManufacturingOrderStatus
      const targetStatus = newStatus as ManufacturingOrderStatus

      const validation = validateStatusTransition(currentStatus, targetStatus, isRTL)
      if (!validation.valid) {
        toast.error(validation.message)
        return
      }

      const orderWithDates = currentOrder as ManufacturingOrderWithItem
      const statusUpdate = prepareStatusUpdate(
        orderId,
        currentStatus,
        targetStatus,
        {
          quantity: currentOrder.quantity,
          start_date: orderWithDates.start_date ?? null,
          due_date: orderWithDates.due_date ?? null
        }
      )

      if (!statusUpdate.success) {
        toast.error(isRTL ? statusUpdate.messageAr : statusUpdate.message)
        return
      }

      await updateOrderStatus.mutateAsync({ 
        id: orderId, 
        status: targetStatus, 
        updateData: statusUpdate.updateData as StatusUpdateData
      })

      toast.success(isRTL ? statusUpdate.messageAr : statusUpdate.message || 'Status updated')
    } catch (error: unknown) {
      const err = error as { message?: string }
      console.error('Error changing status:', error)
      toast.error(err.message || (isRTL ? 'فشل تحديث الحالة' : 'Failed to update status'))
    }
  }

  const handleViewOrder = async (orderId: string) => {
    try {
      setLoadingOrderDetails(true)
      const order = await getOrderDetails(orderId)
      if (order) {
        setSelectedOrder(order)
        setOrderDetailsOpen(true)
      } else {
        toast.error(t('manufacturing.ordersPage.orderNotFound') || 'Order not found')
      }
    } catch (error: unknown) {
      const err = error as { message?: string }
      console.error('Error loading order details:', error)
      toast.error(err.message || t('manufacturing.ordersPage.loadError'))
    } finally {
      setLoadingOrderDetails(false)
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
      <ManufacturingQuickStats orders={orders} />

      {showAddForm && (
        <ManufacturingOrderForm
          form={orderForm}
          setForm={setOrderForm}
          products={products}
          productsLoading={productsLoading}
          dateRange={dateRange}
          setDateRange={setDateRange}
          onSubmit={handleCreateOrder}
          isSubmitting={creatingOrder}
          isRTL={isRTL}
        />
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
                  <TableRow 
                    key={order.id}
                    className="group cursor-pointer hover:bg-accent/50"
                    onClick={() => handleViewOrder(order.id)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {order.order_number || '—'}
                        <Eye className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const orderWithItem = order as ManufacturingOrderWithItem
                        return orderWithItem.item?.name || orderWithItem.item?.product_name || '—'
                      })()}
                    </TableCell>
                    <TableCell>{order.quantity ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={getStatusBadgeVariant(order.status)}>
                          {getStatusLabel(order.status, isRTL)}
                        </Badge>
                        <Select
                          value={order.status}
                          onValueChange={(value) =>
                            handleStatusChange(order.id, value as ManufacturingOrder['status'])
                          }
                          disabled={updateOrderStatus.isPending}
                          onOpenChange={(open) => {
                            if (open) {
                              // Prevent event propagation when select opens
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {getStatusOptions(order.status).map((status) => {
                              const info = getStatusInfo(status as ManufacturingOrderStatus)
                              const isValid = isValidStatusTransition(
                                order.status as ManufacturingOrderStatus,
                                status as ManufacturingOrderStatus
                              ) || status === order.status
                              
                              return (
                                <SelectItem 
                                  key={`${order.id}-${status}`} 
                                  value={status}
                                  disabled={!isValid && status !== order.status}
                                >
                                  <div className="flex items-center gap-2">
                                    <span>{isRTL ? info.labelAr : info.label}</span>
                                    {!isValid && status !== order.status && (
                                      <span className="text-xs text-muted-foreground">
                                        ({isRTL ? 'غير متاح' : 'unavailable'})
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate((order as ManufacturingOrderWithItem).start_date)}</TableCell>
                    <TableCell>{formatDate((order as ManufacturingOrderWithItem).due_date)}</TableCell>
                    <TableCell className="text-right">{order.notes || '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Order Details Dialog */}
      <Dialog open={orderDetailsOpen} onOpenChange={setOrderDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {isRTL ? 'تفاصيل أمر التصنيع' : 'Manufacturing Order Details'} - {selectedOrder?.order_number || '—'}
            </DialogTitle>
            <DialogDescription>
              {isRTL ? 'عرض تفاصيل أمر التصنيع الكاملة' : 'View complete manufacturing order details'}
            </DialogDescription>
          </DialogHeader>

          {(() => {
            if (loadingOrderDetails) {
              return (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              )
            }
            if (!selectedOrder) {
              return null
            }
            return (
              <div className="space-y-6">
              {/* Basic Information */}
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold">{isRTL ? 'المعلومات الأساسية' : 'Basic Information'}</h3>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{isRTL ? 'رقم الأمر' : 'Order Number'}</Label>
                    <p className="font-medium">{selectedOrder.order_number || '—'}</p>
                  </div>
                  <div>
                    <Label>{isRTL ? 'الحالة' : 'Status'}</Label>
                    <div className="mt-1">
                      <Badge variant={getStatusBadgeVariant(selectedOrder.status)}>
                        {getStatusLabel(selectedOrder.status, isRTL)}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label>{isRTL ? 'المنتج' : 'Product'}</Label>
                    <p className="font-medium">
                      {(() => {
                        const orderWithItem = selectedOrder as ManufacturingOrderWithItem
                        return orderWithItem.item?.name || orderWithItem.item?.code || '—'
                      })()}
                    </p>
                  </div>
                  <div>
                    <Label>{isRTL ? 'الكمية المطلوبة' : 'Quantity to Produce'}</Label>
                    <p className="font-medium">{selectedOrder.quantity ?? 0}</p>
                  </div>
                  <div>
                    <Label>{isRTL ? 'تاريخ البدء المخطط' : 'Planned Start Date'}</Label>
                    <p className="font-medium">{formatDate((selectedOrder as ManufacturingOrderWithItem).start_date) || '—'}</p>
                  </div>
                  <div>
                    <Label>{isRTL ? 'تاريخ الانتهاء المخطط' : 'Planned End Date'}</Label>
                    <p className="font-medium">{formatDate((selectedOrder as ManufacturingOrderWithItem).due_date) || '—'}</p>
                  </div>
                  {(selectedOrder as ManufacturingOrderWithItem).created_at && (
                    <div>
                      <Label>{isRTL ? 'تاريخ الإنشاء' : 'Created At'}</Label>
                      <p className="font-medium">{formatDate((selectedOrder as ManufacturingOrderWithItem).created_at)}</p>
                    </div>
                  )}
                  {(selectedOrder as ManufacturingOrderWithItem).updated_at && (
                    <div>
                      <Label>{isRTL ? 'آخر تحديث' : 'Last Updated'}</Label>
                      <p className="font-medium">{formatDate((selectedOrder as ManufacturingOrderWithItem).updated_at)}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Notes */}
              {selectedOrder.notes && (
                <Card>
                  <CardHeader>
                    <h3 className="text-lg font-semibold">{isRTL ? 'ملاحظات' : 'Notes'}</h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedOrder.notes}</p>
                  </CardContent>
                </Card>
              )}

              {/* Product Details */}
              {(() => {
                const orderWithItem = selectedOrder as ManufacturingOrderWithItem
                return orderWithItem.item ? (
                  <Card>
                    <CardHeader>
                      <h3 className="text-lg font-semibold">{isRTL ? 'تفاصيل المنتج' : 'Product Details'}</h3>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>{isRTL ? 'رمز المنتج' : 'Product Code'}</Label>
                        <p className="font-medium">{orderWithItem.item?.code || '—'}</p>
                      </div>
                      <div>
                        <Label>{isRTL ? 'اسم المنتج' : 'Product Name'}</Label>
                        <p className="font-medium">{orderWithItem.item?.name || '—'}</p>
                      </div>
                    </CardContent>
                  </Card>
                ) : null
              })()}
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
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
            {(() => {
              if (isLoading) {
                return (
                  <div className="text-center text-muted-foreground py-10">
                    {t('manufacturing.workCenters.list.loading')}
                  </div>
                )
              }
              if (workCenters.length === 0) {
                return (
                  <div className="text-center text-muted-foreground py-10">
                    {t('manufacturing.workCenters.list.empty')}
                  </div>
                )
              }
              return (
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
              )
            })()}
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
