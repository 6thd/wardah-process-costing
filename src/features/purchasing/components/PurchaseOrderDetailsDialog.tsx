import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type PurchaseOrderLine = {
  id?: string
  line_number?: number
  description?: string | null
  quantity?: number | string | null
  qty_entered?: number | string | null
  unit_price?: number | string | null
  unit_price_entered?: number | string | null
  conversion_factor_snapshot?: number | string | null
  discount_percentage?: number | string | null
  tax_percentage?: number | string | null
  line_total?: number | string | null
  unit?: string | null
  product?: {
    code?: string | null
    name?: string | null
    product_name?: string | null
  } | null
  uom?: {
    code?: string | null
    name?: string | null
    name_ar?: string | null
    symbol?: string | null
  } | null
}

export type PurchaseOrderDetails = {
  id: string
  order_number?: string | null
  order_date?: string | null
  expected_delivery?: string | null
  expected_delivery_date?: string | null
  delivery_date?: string | null
  status?: string | null
  subtotal?: number | string | null
  discount_amount?: number | string | null
  tax_amount?: number | string | null
  vat_amount?: number | string | null
  total_amount?: number | string | null
  notes?: string | null
  vendor?: { name?: string | null } | null
  supplier?: { name?: string | null } | null
  purchase_order_lines?: PurchaseOrderLine[] | null
}

type PurchaseOrderDetailsDialogProps = {
  order: PurchaseOrderDetails | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const numberValue = (value: number | string | null | undefined, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const money = (value: number | string | null | undefined) =>
  numberValue(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const quantity = (value: number | string | null | undefined) =>
  numberValue(value).toLocaleString('en-US', {
    maximumFractionDigits: 6,
  })

const dateLabel = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-US') : '—'

const uomLabel = (line: PurchaseOrderLine) =>
  line.uom?.name_ar || line.uom?.name || line.uom?.code || line.unit || '—'

const productLabel = (line: PurchaseOrderLine) => {
  const code = line.product?.code
  const name = line.product?.product_name || line.product?.name || line.description
  return [code, name].filter(Boolean).join(' - ') || 'منتج غير محدد'
}

export function PurchaseOrderDetailsDialog({
  order,
  open,
  onOpenChange,
}: PurchaseOrderDetailsDialogProps) {
  if (!order) return null

  const lines = order.purchase_order_lines || []
  const supplierName = order.vendor?.name || order.supplier?.name || 'مورد غير محدد'
  const deliveryDate =
    order.expected_delivery_date || order.expected_delivery || order.delivery_date
  const taxAmount = order.tax_amount ?? order.vat_amount

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-h-[92vh] w-[calc(100%-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6"
      >
        <DialogHeader className="text-right">
          <div className="flex flex-wrap items-center justify-between gap-2 pe-8">
            <DialogTitle>{order.order_number || 'تفاصيل أمر الشراء'}</DialogTitle>
            <Badge variant="outline">{order.status || '—'}</Badge>
          </div>
          <DialogDescription className="text-right">
            عرض محفوظ لبيانات أمر الشراء ووحدات القياس وقت الإنشاء.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">المورد</p>
            <p className="font-medium">{supplierName}</p>
          </div>
          <div>
            <p className="text-muted-foreground">تاريخ الأمر</p>
            <p className="font-medium">{dateLabel(order.order_date)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">التسليم المتوقع</p>
            <p className="font-medium">{dateLabel(deliveryDate)}</p>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold">بنود أمر الشراء ({lines.length})</h3>
          {lines.length === 0 ? (
            <div className="rounded-lg border p-4 text-center text-muted-foreground">
              لا توجد بنود محفوظة في هذا الأمر.
            </div>
          ) : (
            lines.map((line, index) => {
              const enteredQuantity = numberValue(line.qty_entered, numberValue(line.quantity))
              const factor = numberValue(line.conversion_factor_snapshot, 1)
              const baseQuantity = numberValue(line.quantity, enteredQuantity * factor)
              const enteredPrice = numberValue(line.unit_price_entered, numberValue(line.unit_price))
              const normalizedPrice = numberValue(
                line.unit_price,
                factor > 0 ? enteredPrice / factor : enteredPrice,
              )

              return (
                <article key={line.id || `${order.id}-${index}`} className="rounded-lg border p-3">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{productLabel(line)}</p>
                      <p className="text-xs text-muted-foreground">
                        السطر {line.line_number || index + 1}
                      </p>
                    </div>
                    <p className="font-bold text-primary">{money(line.line_total)} ريال</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
                    <div>
                      <p className="text-muted-foreground">الكمية التجارية</p>
                      <p className="font-medium">
                        {quantity(enteredQuantity)} {uomLabel(line)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">معامل التحويل</p>
                      <p className="font-medium">{quantity(factor)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">كمية الأساس</p>
                      <p className="font-medium">{quantity(baseQuantity)} كجم</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">السعر التجاري</p>
                      <p className="font-medium">{money(enteredPrice)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">سعر وحدة الأساس</p>
                      <p className="font-medium">{money(normalizedPrice)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">الخصم</p>
                      <p className="font-medium">{quantity(line.discount_percentage)}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">الضريبة</p>
                      <p className="font-medium">{quantity(line.tax_percentage)}%</p>
                    </div>
                  </div>
                </article>
              )
            })
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">الصافي</p>
            <p className="font-semibold">{money(order.subtotal)} ريال</p>
          </div>
          <div>
            <p className="text-muted-foreground">الخصم</p>
            <p className="font-semibold">{money(order.discount_amount)} ريال</p>
          </div>
          <div>
            <p className="text-muted-foreground">الضريبة</p>
            <p className="font-semibold">{money(taxAmount)} ريال</p>
          </div>
          <div>
            <p className="text-muted-foreground">الإجمالي</p>
            <p className="text-lg font-bold text-primary">{money(order.total_amount)} ريال</p>
          </div>
        </div>

        {order.notes && (
          <div className="rounded-lg border p-3 text-sm">
            <p className="text-muted-foreground">ملاحظات</p>
            <p>{order.notes}</p>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              إغلاق
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
