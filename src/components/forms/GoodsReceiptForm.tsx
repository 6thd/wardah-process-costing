import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WarehouseSelector } from '@/components/ui/warehouse-selector'
import { StockBalanceInline } from '@/components/ui/stock-balance-badge'
import {
  createReceiptDraftLine,
  listUomReceivablePurchaseOrders,
  postUomGoodsReceipt,
  validateReceiptQuantity,
  type ReceivablePurchaseOrder,
  type ReceiptDraftLine,
  type ReceiptQualityStatus,
} from '@/services/uom-goods-receipt-service'

interface GoodsReceiptFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess?: () => void
}

const QUALITY_OPTIONS: Array<{ value: ReceiptQualityStatus; label: string }> = [
  { value: 'accepted', label: 'مقبول' },
  { value: 'rejected', label: 'مرفوض' },
]

const ERROR_MESSAGES: Record<string, string> = {
  ORG_ID_REQUIRED: 'لم يتم تحديد المؤسسة الحالية.',
  UOM_ENGINE_NOT_ENABLED_FOR_ORG: 'محرك وحدات القياس غير مفعّل لهذه المؤسسة.',
  RECEIPT_QUANTITY_MUST_BE_POSITIVE: 'يجب أن تكون كمية الاستلام أكبر من صفر.',
  RECEIPT_QUANTITY_EXCEEDS_OPEN_BALANCE: 'كمية الاستلام تتجاوز الرصيد المفتوح في أمر الشراء.',
  NO_OPEN_QUANTITY: 'لا توجد كمية مفتوحة لهذا السطر.',
  RECEIPT_LINES_REQUIRED: 'اختر سطرًا واحدًا على الأقل للاستلام.',
  WAREHOUSE_REQUIRED: 'يجب اختيار المخزن.',
  PO_NOT_RECEIVABLE: 'أمر الشراء غير معتمد أو غير قابل للاستلام.',
  OVER_RECEIPT: 'كمية الاستلام تتجاوز الرصيد التعاقدي المفتوح.',
  REJECTED_QUANTITY_EXCEEDS_OPEN_BALANCE: 'الكمية المرفوضة تتجاوز الرصيد المفتوح.',
  PENDING_INSPECTION_REQUIRES_RESOLUTION_FLOW: 'قيد الفحص يحتاج مسار حسم مستقل قبل استخدامه.',
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : String((error as { message?: string } | null)?.message ?? error)

  const key = Object.keys(ERROR_MESSAGES).find((candidate) => message.includes(candidate))
  return key ? ERROR_MESSAGES[key] : message || 'تعذر إنشاء سند الاستلام.'
}

function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function displayNumber(value: number, decimalPlaces = 6): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalPlaces,
  })
}

export function GoodsReceiptForm({ open, onOpenChange, onSuccess }: GoodsReceiptFormProps) {
  const { currentOrgId } = useAuth()
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [saving, setSaving] = useState(false)
  const [orders, setOrders] = useState<ReceivablePurchaseOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [lines, setLines] = useState<ReceiptDraftLine[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [receiptDate, setReceiptDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState('')
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null)

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  )

  const loadOrders = async () => {
    if (!currentOrgId) {
      setOrders([])
      setSelectedOrderId('')
      setLines([])
      return
    }

    setLoadingOrders(true)
    try {
      const data = await listUomReceivablePurchaseOrders(currentOrgId)
      setOrders(data)
      setSelectedOrderId((current) => data.some((order) => order.id === current) ? current : '')
      if (data.length === 0) toast.info('لا توجد أوامر شراء معتمدة جاهزة للاستلام')
    } catch (error) {
      console.error('Failed to load receivable purchase orders:', error)
      setOrders([])
      toast.error(getErrorMessage(error))
    } finally {
      setLoadingOrders(false)
    }
  }

  useEffect(() => {
    if (open) void loadOrders()
  }, [open, currentOrgId])

  useEffect(() => {
    if (!selectedOrder) {
      setLines([])
      return
    }
    setLines(selectedOrder.lines.map(createReceiptDraftLine))
    idempotencyRef.current = null
  }, [selectedOrder])

  const updateLine = <K extends keyof ReceiptDraftLine>(
    index: number,
    field: K,
    value: ReceiptDraftLine[K],
  ) => {
    setLines((current) => current.map((line, currentIndex) => (
      currentIndex === index ? { ...line, [field]: value } : line
    )))
    idempotencyRef.current = null
  }

  const validateSelectedLines = (): ReceiptDraftLine[] => {
    const selected = lines.filter((line) => line.is_selected)
    if (selected.length === 0) throw new Error('RECEIPT_LINES_REQUIRED')

    for (const line of selected) {
      validateReceiptQuantity(line.receipt_qty_entered, line.remaining_qty_entered)
    }
    return selected
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!currentOrgId) {
      toast.error(ERROR_MESSAGES.ORG_ID_REQUIRED)
      return
    }
    if (!selectedOrder) {
      toast.error('اختر أمر شراء معتمدًا.')
      return
    }
    if (!warehouseId) {
      toast.error(ERROR_MESSAGES.WAREHOUSE_REQUIRED)
      return
    }

    try {
      const selectedLines = validateSelectedLines()
      const fingerprint = JSON.stringify({
        orgId: currentOrgId,
        purchaseOrderId: selectedOrder.id,
        warehouseId,
        receiptDate,
        notes,
        lines: selectedLines.map((line) => ({
          id: line.id,
          quantity: line.receipt_qty_entered,
          quality: line.quality_status,
          uomId: line.uom_id,
          factor: line.conversion_factor_snapshot,
          cost: line.unit_cost_entered,
        })),
      })

      if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
        idempotencyRef.current = {
          fingerprint,
          key: globalThis.crypto.randomUUID(),
        }
      }

      setSaving(true)
      const result = await postUomGoodsReceipt({
        orgId: currentOrgId,
        purchaseOrder: selectedOrder,
        warehouseId,
        receiptDate,
        notes,
        lines: selectedLines,
        idempotencyKey: idempotencyRef.current.key,
      })

      toast.success(`تم إنشاء سند الاستلام ${result.receipt_number ?? ''}`.trim())
      idempotencyRef.current = null
      setSelectedOrderId('')
      setLines([])
      setWarehouseId('')
      setNotes('')
      await loadOrders()
      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to post partial UoM goods receipt:', error)
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const allSelected = lines.length > 0 && lines.every((line) => line.is_selected)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة سند استلام جزئي</DialogTitle>
          <DialogDescription>
            الاستلام يعتمد وحدة ومعامل وسعر أمر الشراء المحفوظة، ويحوّل إلى وحدة الأساس داخل المعاملة الذرية.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="purchase-order">أمر الشراء المعتمد *</Label>
              <Select
                value={selectedOrderId}
                onValueChange={setSelectedOrderId}
                disabled={loadingOrders || saving}
              >
                <SelectTrigger id="purchase-order">
                  <SelectValue placeholder={loadingOrders ? 'جاري التحميل...' : 'اختر أمر الشراء'} />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_number} — {order.vendor.name} — {order.total_amount.toLocaleString('en-US')} ر.س
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loadingOrders && orders.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  لا تظهر المسودات أو الأوامر المقدمة؛ الاعتماد الإداري شرط قبل الاستلام.
                </p>
              )}
            </div>

            <WarehouseSelector
              value={warehouseId}
              onChange={(value) => {
                setWarehouseId(value)
                idempotencyRef.current = null
              }}
              required
              disabled={!selectedOrder || saving}
              label="المخزن *"
              showLabel
            />

            <div className="space-y-2">
              <Label htmlFor="receipt-date">تاريخ الاستلام *</Label>
              <Input
                id="receipt-date"
                type="date"
                value={receiptDate}
                onChange={(event) => {
                  setReceiptDate(event.target.value)
                  idempotencyRef.current = null
                }}
                disabled={saving}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="receipt-notes">ملاحظات</Label>
              <Input
                id="receipt-notes"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value)
                  idempotencyRef.current = null
                }}
                disabled={saving}
                placeholder="مرجع الشحنة أو ملاحظات الاستلام"
              />
            </div>
          </div>

          {selectedOrder && (
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <span className="text-muted-foreground">المورد</span>
                  <p className="font-medium">{selectedOrder.vendor.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">تاريخ الأمر</span>
                  <p className="font-medium">{new Date(selectedOrder.order_date).toLocaleDateString('en-US')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">الحالة</span>
                  <p className="font-medium">{selectedOrder.status === 'approved' ? 'معتمد' : 'مستلم جزئيًا'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">الإجمالي</span>
                  <p className="font-medium">{selectedOrder.total_amount.toLocaleString('en-US')} ر.س</p>
                </div>
              </div>
            </div>
          )}

          {lines.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">سطور الاستلام</h3>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) => {
                      setLines((current) => current.map((line) => ({
                        ...line,
                        is_selected: Boolean(checked) && line.remaining_qty_entered > 0,
                      })))
                      idempotencyRef.current = null
                    }}
                  />
                  تحديد الكل
                </label>
              </div>

              <div className="grid gap-3">
                {lines.map((line, index) => {
                  const unitLabel = line.uom.symbol || line.uom.name_ar || line.uom.name || line.uom.code || 'وحدة'
                  const basePreview = roundQuantity(
                    line.receipt_qty_entered * line.conversion_factor_snapshot,
                  )
                  const productName = line.product.name_ar || line.product.name || line.product.code || 'منتج'

                  return (
                    <div key={line.id} className="rounded-lg border bg-card p-4">
                      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_repeat(3,minmax(130px,0.55fr))] lg:items-end">
                        <div className="self-start pt-1">
                          <Checkbox
                            checked={line.is_selected}
                            disabled={line.remaining_qty_entered <= 0 || saving}
                            onCheckedChange={(checked) => updateLine(index, 'is_selected', Boolean(checked))}
                            aria-label={`اختيار ${productName}`}
                          />
                        </div>

                        <div className="min-w-0">
                          <p className="font-semibold">{productName}</p>
                          <p className="text-sm text-muted-foreground">{line.product.code ?? '—'}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>المطلوب: {displayNumber(line.ordered_qty_entered)} {unitLabel}</span>
                            <span>المستلم ماديًا: {displayNumber(line.received_qty_entered)} {unitLabel}</span>
                            <span>المتبقي: {displayNumber(line.remaining_qty_entered)} {unitLabel}</span>
                            <span>المعامل: {displayNumber(line.conversion_factor_snapshot)}</span>
                          </div>
                          {warehouseId && (
                            <div className="mt-2">
                              <StockBalanceInline productId={line.product_id} warehouseId={warehouseId} />
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`receipt-qty-${line.id}`}>الكمية المستلمة ({unitLabel})</Label>
                          <Input
                            id={`receipt-qty-${line.id}`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={line.remaining_qty_entered}
                            step="any"
                            value={line.receipt_qty_entered}
                            disabled={!line.is_selected || saving}
                            onChange={(event) => {
                              const value = Number(event.target.value)
                              updateLine(index, 'receipt_qty_entered', Number.isFinite(value) ? value : 0)
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            = {displayNumber(basePreview)} بوحدة الأساس
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`quality-${line.id}`}>حالة الجودة</Label>
                          <Select
                            value={line.quality_status}
                            onValueChange={(value) => updateLine(
                              index,
                              'quality_status',
                              value as ReceiptQualityStatus,
                            )}
                            disabled={!line.is_selected || saving}
                          >
                            <SelectTrigger id={`quality-${line.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {QUALITY_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            قيد الفحص غير متاح حتى بناء مسار حسم ذري مستقل.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>تكلفة الوحدة التجارية</Label>
                          <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm font-medium">
                            {line.unit_cost_entered.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 6,
                            })} ر.س
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {selectedOrder && lines.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              لا توجد سطور مفتوحة قابلة للاستلام في هذا الأمر.
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={saving || !selectedOrder || lines.every((line) => !line.is_selected)}
            >
              {saving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              {saving ? 'جاري الترحيل...' : 'تأكيد الاستلام الجزئي'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
