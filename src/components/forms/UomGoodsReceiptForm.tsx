import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
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
import { useAuth } from '@/contexts/AuthContext'
import { receiveGoods } from '@/services/purchasing-service'
import {
  buildGoodsReceiptLine,
  createReceiptDraftLine,
  listUomReceivablePurchaseOrders,
  validateReceiptQuantity,
  type ReceivablePurchaseOrder,
  type ReceiptDraftLine,
  type ReceiptQualityStatus,
} from '@/services/uom-goods-receipt-service'

interface UomGoodsReceiptFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess?: () => void
}

const QUALITY_LABELS: Record<ReceiptQualityStatus, string> = {
  accepted: 'مقبول',
  rejected: 'مرفوض',
}

function formatNumber(value: number, decimals = 6): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: decimals,
  })
}

function getProductName(line: ReceiptDraftLine): string {
  return line.product.name_ar || line.product.name || line.product.code || 'منتج'
}

export function UomGoodsReceiptForm({
  open,
  onOpenChange,
  onSuccess,
}: UomGoodsReceiptFormProps) {
  const { currentOrgId } = useAuth()
  const [orders, setOrders] = useState<ReceivablePurchaseOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [lines, setLines] = useState<ReceiptDraftLine[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [receiptDate, setReceiptDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState('')
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [saving, setSaving] = useState(false)
  const idempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null)

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  )

  useEffect(() => {
    if (!open || !currentOrgId) return

    let active = true
    setLoadingOrders(true)
    void listUomReceivablePurchaseOrders(currentOrgId)
      .then((data) => {
        if (!active) return
        setOrders(data)
        if (data.length === 0) toast.info('لا توجد أوامر شراء معتمدة قابلة للاستلام')
      })
      .catch((error) => {
        if (!active) return
        console.error('Failed to load receivable purchase orders:', error)
        toast.error('تعذر تحميل أوامر الشراء القابلة للاستلام')
      })
      .finally(() => {
        if (active) setLoadingOrders(false)
      })

    return () => {
      active = false
    }
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
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line,
      ),
    )
    idempotencyRef.current = null
  }

  const reset = () => {
    setSelectedOrderId('')
    setLines([])
    setWarehouseId('')
    setReceiptDate(format(new Date(), 'yyyy-MM-dd'))
    setNotes('')
    idempotencyRef.current = null
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !saving) reset()
    onOpenChange(nextOpen)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!currentOrgId || !selectedOrder) {
      toast.error('اختر أمر شراء معتمدًا')
      return
    }
    if (!warehouseId) {
      toast.error('اختر المخزن')
      return
    }

    const selectedLines = lines.filter((line) => line.is_selected)
    if (selectedLines.length === 0) {
      toast.error('اختر سطرًا واحدًا على الأقل')
      return
    }

    try {
      selectedLines.forEach((line) =>
        validateReceiptQuantity(line.receipt_qty_entered, line.remaining_qty_entered),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      toast.error(
        message === 'RECEIPT_QUANTITY_EXCEEDS_OPEN_BALANCE'
          ? 'كمية الاستلام لا يمكن أن تتجاوز الرصيد المفتوح'
          : 'أدخل كمية استلام صحيحة وأكبر من صفر',
      )
      return
    }

    const receipt = {
      purchase_order_id: selectedOrder.id,
      vendor_id: selectedOrder.vendor_id,
      receipt_date: receiptDate,
      warehouse_id: warehouseId,
      notes: notes || undefined,
    }
    const receiptLines = selectedLines.map(buildGoodsReceiptLine)
    const fingerprint = JSON.stringify({ ...receipt, lines: receiptLines })
    if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
      idempotencyRef.current = {
        key: globalThis.crypto.randomUUID(),
        fingerprint,
      }
    }

    setSaving(true)
    try {
      const result = await receiveGoods(receipt, receiptLines, idempotencyRef.current.key)
      if (!result.success) throw result.error || new Error('GOODS_RECEIPT_FAILED')

      idempotencyRef.current = null
      toast.success('تم تسجيل الاستلام الجزئي بنجاح')
      if (result.glWarning) toast.warning(result.glWarning, { duration: 10000 })
      reset()
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error('Failed to post UoM goods receipt:', error)
      const message = error instanceof Error ? error.message : ''
      if (message.includes('OVER_RECEIPT')) {
        toast.error('الكمية تجاوزت الرصيد المفتوح وتم رفض العملية بالكامل')
      } else if (message.includes('PO_NOT_RECEIVABLE')) {
        toast.error('أمر الشراء غير معتمد أو لم يعد قابلًا للاستلام')
      } else if (message.includes('PENDING_INSPECTION_REQUIRES_RESOLUTION_FLOW')) {
        toast.error('قيد الفحص غير متاح حتى اكتمال مسار حسم الجودة')
      } else {
        toast.error('تعذر تسجيل سند الاستلام')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>استلام جزئي بوحدة أمر الشراء</DialogTitle>
          <DialogDescription>
            أدخل الكمية المستلمة فعليًا. يحوّل الخادم الكمية إلى وحدة الأساس وفق Snapshot أمر الشراء.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="uom-receipt-po">أمر الشراء المعتمد *</Label>
              <Select
                value={selectedOrderId}
                onValueChange={setSelectedOrderId}
                disabled={loadingOrders || saving}
              >
                <SelectTrigger id="uom-receipt-po">
                  <SelectValue placeholder={loadingOrders ? 'جاري التحميل…' : 'اختر أمر الشراء'} />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_number} — {order.vendor.name} —{' '}
                      {order.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ريال
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <WarehouseSelector
              value={warehouseId}
              onChange={setWarehouseId}
              required
              disabled={!selectedOrder || saving}
              label="المخزن *"
              showLabel
            />

            <div className="space-y-2">
              <Label htmlFor="uom-receipt-date">تاريخ الاستلام *</Label>
              <Input
                id="uom-receipt-date"
                type="date"
                value={receiptDate}
                onChange={(event) => setReceiptDate(event.target.value)}
                disabled={saving}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="uom-receipt-notes">ملاحظات</Label>
              <Input
                id="uom-receipt-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          {selectedOrder && (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="text-muted-foreground">الأمر:</span> {selectedOrder.order_number}</div>
                <div><span className="text-muted-foreground">المورد:</span> {selectedOrder.vendor.name}</div>
                <div><span className="text-muted-foreground">الحالة:</span> {selectedOrder.status}</div>
                <div><span className="text-muted-foreground">التاريخ:</span> {selectedOrder.order_date}</div>
              </div>
            </div>
          )}

          {lines.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">سطور الاستلام</h3>
                <p className="text-xs text-muted-foreground">
                  قيد الفحص غير متاح في هذه المرحلة؛ يستخدم المقبول أو المرفوض فقط.
                </p>
              </div>

              <div className="space-y-3 lg:hidden">
                {lines.map((line, index) => {
                  const basePreview =
                    Math.round(line.receipt_qty_entered * line.conversion_factor_snapshot * 1_000_000) /
                    1_000_000
                  return (
                    <div key={line.id} className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={line.is_selected}
                          onCheckedChange={(value) => updateLine(index, 'is_selected', Boolean(value))}
                          disabled={saving || line.remaining_qty_entered <= 0}
                          aria-label={`اختيار ${getProductName(line)}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{getProductName(line)}</p>
                          <p className="text-xs text-muted-foreground">{line.product.code || '—'}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>المطلوب: {formatNumber(line.ordered_qty_entered)} {line.uom.symbol}</div>
                        <div>المتبقي: {formatNumber(line.remaining_qty_entered)} {line.uom.symbol}</div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor={`receipt-qty-mobile-${line.id}`}>الكمية المستلمة</Label>
                          <Input
                            id={`receipt-qty-mobile-${line.id}`}
                            type="number"
                            min="0"
                            max={line.remaining_qty_entered}
                            step="any"
                            value={line.receipt_qty_entered}
                            onChange={(event) => updateLine(index, 'receipt_qty_entered', Number(event.target.value))}
                            disabled={!line.is_selected || saving}
                          />
                          <p className="text-xs text-muted-foreground">
                            = {formatNumber(basePreview)} وحدة أساس — معامل {formatNumber(line.conversion_factor_snapshot)}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`receipt-quality-mobile-${line.id}`}>الجودة</Label>
                          <Select
                            value={line.quality_status}
                            onValueChange={(value) => updateLine(index, 'quality_status', value as ReceiptQualityStatus)}
                            disabled={!line.is_selected || saving}
                          >
                            <SelectTrigger id={`receipt-quality-mobile-${line.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(QUALITY_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="hidden overflow-x-auto rounded-lg border lg:block">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-3 text-center">اختيار</th>
                      <th className="p-3 text-right">المنتج</th>
                      <th className="p-3 text-right">الوحدة</th>
                      <th className="p-3 text-right">المطلوب</th>
                      <th className="p-3 text-right">المتبقي</th>
                      <th className="p-3 text-right">الاستلام الحالي</th>
                      <th className="p-3 text-right">وحدة الأساس</th>
                      <th className="p-3 text-right">الجودة</th>
                      <th className="p-3 text-right">السعر التجاري</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => {
                      const basePreview =
                        Math.round(line.receipt_qty_entered * line.conversion_factor_snapshot * 1_000_000) /
                        1_000_000
                      return (
                        <tr key={line.id} className="border-t">
                          <td className="p-3 text-center">
                            <Checkbox
                              checked={line.is_selected}
                              onCheckedChange={(value) => updateLine(index, 'is_selected', Boolean(value))}
                              disabled={saving || line.remaining_qty_entered <= 0}
                            />
                          </td>
                          <td className="p-3">
                            <p className="font-medium">{getProductName(line)}</p>
                            <p className="text-xs text-muted-foreground">{line.product.code || '—'}</p>
                          </td>
                          <td className="p-3">{line.uom.symbol || line.uom.code || '—'}</td>
                          <td className="p-3">{formatNumber(line.ordered_qty_entered)}</td>
                          <td className="p-3 font-medium text-amber-600">{formatNumber(line.remaining_qty_entered)}</td>
                          <td className="p-3">
                            <Input
                              aria-label={`كمية استلام ${getProductName(line)}`}
                              className="w-32"
                              type="number"
                              min="0"
                              max={line.remaining_qty_entered}
                              step="any"
                              value={line.receipt_qty_entered}
                              onChange={(event) => updateLine(index, 'receipt_qty_entered', Number(event.target.value))}
                              disabled={!line.is_selected || saving}
                            />
                          </td>
                          <td className="p-3">
                            {formatNumber(basePreview)}
                            <p className="text-xs text-muted-foreground">× {formatNumber(line.conversion_factor_snapshot)}</p>
                          </td>
                          <td className="p-3">
                            <Select
                              value={line.quality_status}
                              onValueChange={(value) => updateLine(index, 'quality_status', value as ReceiptQualityStatus)}
                              disabled={!line.is_selected || saving}
                            >
                              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(QUALITY_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-3">{line.unit_cost_entered.toLocaleString('en-US', { minimumFractionDigits: 2 })} ريال</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button type="submit" disabled={saving || !selectedOrder || lines.length === 0}>
              {saving ? 'جاري الترحيل…' : 'تأكيد الاستلام'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
