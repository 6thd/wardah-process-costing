import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { PurchaseOrderForm } from '@/components/forms/PurchaseOrderForm'
import { supabase } from '@/lib/supabase'
import {
  newPurchaseOrdersService,
  purchaseOrdersService,
} from '@/services/supabase-service'
import { toast } from 'sonner'
import { PurchasingModule } from './index'
import {
  PurchaseOrderDetailsDialog,
  type PurchaseOrderDetails,
} from './components/PurchaseOrderDetailsDialog'

type PurchaseOrderListItem = PurchaseOrderDetails & {
  expected_delivery?: string | null
  delivery_date?: string | null
  vat_amount?: number | string | null
}

const toNumber = (value: number | string | null | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const statusConfig: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  DRAFT: { label: 'مسودة', variant: 'outline' },
  CONFIRMED: { label: 'مؤكد', variant: 'default' },
  APPROVED: { label: 'معتمد', variant: 'default' },
  RECEIVED: { label: 'مستلم', variant: 'secondary' },
  CANCELLED: { label: 'ملغى', variant: 'destructive' },
  draft: { label: 'مسودة', variant: 'outline' },
  confirmed: { label: 'مؤكد', variant: 'default' },
  approved: { label: 'معتمد', variant: 'default' },
  received: { label: 'مستلم', variant: 'secondary' },
  fully_received: { label: 'مستلم بالكامل', variant: 'secondary' },
  cancelled: { label: 'ملغى', variant: 'destructive' },
}

function PurchaseOrderStatusBadge({ status }: { status?: string | null }) {
  const config = statusConfig[status || ''] || {
    label: status || '—',
    variant: 'outline' as const,
  }
  return <Badge variant={config.variant}>{config.label}</Badge>
}

async function loadPurchaseOrderDetails(id: string): Promise<PurchaseOrderDetails> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
      vendor:vendors(id, name, code),
      purchase_order_lines(
        *,
        product:products(id, code, name, product_name),
        uom:uoms(id, code, name, name_ar, symbol)
      )
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data as unknown as PurchaseOrderDetails
}

function PurchaseOrdersDetailsManagement() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<PurchaseOrderListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderDetails | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null)

  const loadOrders = async () => {
    setLoading(true)
    try {
      try {
        const data = await newPurchaseOrdersService.getAll()
        setOrders((data || []) as unknown as PurchaseOrderListItem[])
      } catch (newError) {
        console.warn('New purchase order reader unavailable; using legacy reader.', newError)
        const data = await purchaseOrdersService.getAll()
        setOrders((data || []) as unknown as PurchaseOrderListItem[])
      }
    } catch (error) {
      console.error('Error loading purchase orders:', error)
      toast.error('خطأ في تحميل أوامر الشراء')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOrders()
  }, [])

  const openDetails = async (order: PurchaseOrderListItem) => {
    setDetailsLoadingId(order.id)
    try {
      const fullOrder = await loadPurchaseOrderDetails(order.id)
      setSelectedOrder(fullOrder)
      setDetailsOpen(true)
    } catch (error) {
      console.error('Error loading purchase order details:', error)
      toast.error('تعذر تحميل تفاصيل أمر الشراء')
    } finally {
      setDetailsLoadingId(null)
    }
  }

  if (loading) {
    return <LoadingSpinner label={t('common.loading')} />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('purchasing.purchaseOrders')}</h1>
          <p className="text-muted-foreground">أوامر الشراء</p>
        </div>
        <Button onClick={() => setShowAddForm(true)}>+ إضافة أمر شراء</Button>
      </div>

      <PurchaseOrderForm
        open={showAddForm}
        onOpenChange={setShowAddForm}
        onSuccess={() => {
          void loadOrders()
        }}
      />

      <PurchaseOrderDetailsDialog
        order={selectedOrder}
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open)
          if (!open) setSelectedOrder(null)
        }}
      />

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="font-semibold">قائمة أوامر الشراء ({orders.length})</h3>
          {orders.length === 0 && <Badge variant="outline">لا توجد بيانات</Badge>}
        </div>

        <div className="divide-y">
          {orders.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              لا توجد أوامر شراء مسجلة.
            </div>
          ) : (
            orders.map((order) => {
              const lines = order.purchase_order_lines || []
              const isOpening = detailsLoadingId === order.id
              const deliveryDate =
                order.expected_delivery_date || order.expected_delivery || order.delivery_date
              const taxAmount = order.tax_amount ?? order.vat_amount

              return (
                <button
                  key={order.id}
                  type="button"
                  className="block w-full p-4 text-start transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-wait disabled:opacity-70"
                  onClick={() => void openDetails(order)}
                  disabled={detailsLoadingId !== null}
                  aria-label={`عرض تفاصيل أمر الشراء ${order.order_number || ''}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="break-all text-lg font-medium">{order.order_number}</h4>
                        {isOpening && <span className="text-xs text-muted-foreground">جاري الفتح...</span>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {order.vendor?.name || order.supplier?.name || 'مورد غير محدد'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span>📅 {order.order_date ? new Date(order.order_date).toLocaleDateString('en-US') : '—'}</span>
                        {deliveryDate && (
                          <span>🚚 التسليم: {new Date(deliveryDate).toLocaleDateString('en-US')}</span>
                        )}
                      </div>

                      {lines.length > 0 && (
                        <div className="mt-3 text-sm">
                          <p className="mb-1 font-medium text-muted-foreground">
                            المنتجات ({lines.length}):
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {lines.slice(0, 3).map((line, index) => (
                              <Badge key={line.id || `${order.id}-${index}`} variant="outline" className="text-xs">
                                {line.product?.product_name || line.product?.name || line.description || 'منتج'}
                                {' '}({toNumber(line.qty_entered ?? line.quantity).toLocaleString('en-US')})
                              </Badge>
                            ))}
                            {lines.length > 3 && (
                              <Badge variant="outline" className="text-xs">+{lines.length - 3} المزيد</Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 text-start sm:text-end">
                      <PurchaseOrderStatusBadge status={order.status} />
                      <div className="mt-2 text-lg font-bold text-primary">
                        {toNumber(order.total_amount).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        ريال
                      </div>
                      {toNumber(taxAmount) > 0 && (
                        <div className="text-xs text-muted-foreground">
                          شامل ضريبة: {toNumber(taxAmount).toFixed(2)} ريال
                        </div>
                      )}
                      <div className="mt-2 text-xs font-medium text-primary">اضغط لعرض التفاصيل</div>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export function PurchasingModuleHotfix() {
  const location = useLocation()
  const normalizedPath = location.pathname.replace(/\/+$/, '')

  if (normalizedPath === '/purchasing/orders') {
    return <PurchaseOrdersDetailsManagement />
  }

  return <PurchasingModule />
}
