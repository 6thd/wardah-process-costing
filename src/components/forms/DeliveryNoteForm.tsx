import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { createDeliveryNote } from '@/services/enhanced-sales-service'
import { Loader2, Package, Truck, Calendar, DollarSign, CalendarIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface DeliveryNoteFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess: () => void
}

interface SalesInvoice {
  id: string
  invoice_number: string
  invoice_date: string
  customer_id: string
  status: string
  total_amount: number
  customer?: {
    code: string
    name: string
  }
}

interface InvoiceLine {
  id: string
  product_id: string
  quantity: number
  delivered_quantity: number
  unit_price: number
  discount_amount: number
  tax_amount: number
  line_total: number
  product?: {
    id: string
    code: string
    name: string
    stock_quantity: number
  }
}

interface DeliveryLine {
  invoice_line_id: string
  product_id: string
  product_name: string
  product_code: string
  ordered_quantity: number
  already_delivered: number
  remaining_quantity: number
  quantity_to_deliver: number
  unit_price: number
  selected: boolean
  available_stock: number
}

export function DeliveryNoteForm({ open, onOpenChange, onSuccess }: DeliveryNoteFormProps) {
  const [loading, setLoading] = useState(false)
  const [loadingInvoices, setLoadingInvoices] = useState(true)
  const [availableInvoices, setAvailableInvoices] = useState<SalesInvoice[]>([])
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<SalesInvoice | null>(null)
  const [deliveryLines, setDeliveryLines] = useState<DeliveryLine[]>([])
  const [deliveryDate, setDeliveryDate] = useState<Date>(new Date())
  const [notes, setNotes] = useState('')

  // Load available sales invoices (confirmed or partially_delivered)
  useEffect(() => {
    if (open) {
      loadAvailableInvoices()
    }
  }, [open])

  const loadAvailableInvoices = async () => {
    setLoadingInvoices(true)
    try {
      const { data, error } = await supabase
        .from('sales_invoices')
        .select('*, customer:customers(code, name)')
        .in('status', ['confirmed', 'partially_delivered'])
        .order('invoice_date', { ascending: false })

      if (error) throw error
      setAvailableInvoices(data || [])
    } catch (error) {
      console.error('Error loading invoices:', error)
      toast.error('خطأ في تحميل الفواتير')
    } finally {
      setLoadingInvoices(false)
    }
  }

  // Load invoice lines when invoice is selected
  useEffect(() => {
    if (selectedInvoiceId) {
      loadInvoiceLines(selectedInvoiceId)
    } else {
      setDeliveryLines([])
      setSelectedInvoice(null)
    }
  }, [selectedInvoiceId])

  const loadInvoiceLines = async (invoiceId: string) => {
    setLoading(true)
    try {
      // Get invoice details
      const invoice = availableInvoices.find(inv => inv.id === invoiceId)
      setSelectedInvoice(invoice || null)

      // Get invoice lines with product details
      const { data, error } = await supabase
        .from('sales_invoice_lines')
        .select('*, product:products(id, code, name, stock_quantity)')
        .eq('invoice_id', invoiceId)

      if (error) throw error

      // Transform to delivery lines
      const lines: DeliveryLine[] = (data || []).map((line: InvoiceLine) => {
        const orderedQty = line.quantity
        const alreadyDelivered = line.delivered_quantity || 0
        const remaining = orderedQty - alreadyDelivered
        const availableStock = line.product?.stock_quantity || 0

        return {
          invoice_line_id: line.id,
          product_id: line.product_id,
          product_name: line.product?.name || 'منتج غير محدد',
          product_code: line.product?.code || '',
          ordered_quantity: orderedQty,
          already_delivered: alreadyDelivered,
          remaining_quantity: remaining,
          quantity_to_deliver: Math.min(remaining, availableStock), // Don't deliver more than available
          unit_price: line.unit_price,
          selected: remaining > 0 && availableStock > 0, // Auto-select if there's remaining and stock available
          available_stock: availableStock
        }
      })

      setDeliveryLines(lines)
    } catch (error) {
      console.error('Error loading invoice lines:', error)
      toast.error('خطأ في تحميل بنود الفاتورة')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectAll = (checked: boolean) => {
    setDeliveryLines(lines =>
      lines.map(line => ({
        ...line,
        selected: checked && line.remaining_quantity > 0 && line.available_stock > 0
      }))
    )
  }

  const handleLineSelect = (index: number, checked: boolean) => {
    setDeliveryLines(lines =>
      lines.map((line, i) =>
        i === index ? { ...line, selected: checked } : line
      )
    )
  }

  const handleQuantityChange = (index: number, value: string) => {
    const qty = Number.parseFloat(value) || 0
    setDeliveryLines(lines =>
      lines.map((line, i) => {
        if (i === index) {
          // Can't deliver more than remaining or available stock
          const maxQty = Math.min(line.remaining_quantity, line.available_stock)
          return { ...line, quantity_to_deliver: Math.min(qty, maxQty) }
        }
        return line
      })
    )
  }

  const handleSubmit = async () => {
    // Validation
    const selectedLines = deliveryLines.filter(line => line.selected)
    if (selectedLines.length === 0) {
      toast.error('الرجاء اختيار بند واحد على الأقل')
      return
    }

    if (!deliveryDate) {
      toast.error('الرجاء إدخال تاريخ التسليم')
      return
    }

    // Check if any quantity exceeds available stock
    const insufficientStock = selectedLines.find(line => line.quantity_to_deliver > line.available_stock)
    if (insufficientStock) {
      toast.error(`المخزون غير كافٍ للمنتج: ${insufficientStock.product_name}`)
      return
    }

    setLoading(true)

    try {
      if (!selectedInvoice) {
        toast.error('الرجاء اختيار فاتورة')
        return
      }

      // Prepare delivery data for enhanced service
      const deliveryData = {
        sales_invoice_id: selectedInvoiceId,
        customer_id: selectedInvoice.customer_id,
        delivery_date: format(deliveryDate, 'yyyy-MM-dd'),
        vehicle_number: undefined,
        driver_name: undefined,
        notes: notes || undefined,
        lines: selectedLines.map(line => ({
          sales_invoice_line_id: line.invoice_line_id,
          item_id: line.product_id,
          invoiced_quantity: line.ordered_quantity,
          delivered_quantity: line.quantity_to_deliver,
          unit_price: line.unit_price,
          unit_cost_at_delivery: (line as any).unit_cost || 0,
          cogs_amount: ((line as any).unit_cost || 0) * line.quantity_to_deliver,
          notes: undefined
        }))
      }

      // Use enhanced sales service
      const result = await createDeliveryNote(deliveryData)

      if (result.success && result.data) {
        toast.success(`تم إنشاء مذكرة التسليم ${result.data.delivery_number || result.data.id} بنجاح`)
        if (result.totalCOGS) {
          toast.info(`تم حساب COGS: ${result.totalCOGS.toFixed(2)} ريال`)
        }
        onSuccess()
        resetForm()
        onOpenChange(false)
      } else {
        throw new Error(result.error || 'فشل في إنشاء مذكرة التسليم')
      }
    } catch (error) {
      console.error('Error creating delivery note:', error)
      toast.error('خطأ في إنشاء مذكرة التسليم')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setSelectedInvoiceId('')
    setSelectedInvoice(null)
    setDeliveryLines([])
    setDeliveryDate(new Date())
    setNotes('')
  }

  const selectedCount = deliveryLines.filter(line => line.selected).length
  const totalToDeliver = deliveryLines
    .filter(line => line.selected)
    .reduce((sum, line) => sum + (line.quantity_to_deliver * line.unit_price), 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-2xl">إضافة مذكرة تسليم جديدة</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Invoice Selection */}
          <div className="space-y-2">
            <Label>اختر الفاتورة *</Label>
            <Select value={selectedInvoiceId} onValueChange={setSelectedInvoiceId}>
              <SelectTrigger>
                <SelectValue placeholder={loadingInvoices ? 'جاري التحميل...' : 'اختر فاتورة مبيعات'} />
              </SelectTrigger>
              <SelectContent>
                {availableInvoices.map(invoice => (
                  <SelectItem key={invoice.id} value={invoice.id}>
                    {invoice.invoice_number} - {invoice.customer?.name || 'عميل غير محدد'} - {invoice.total_amount.toFixed(2)} ريال
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Invoice Details */}
          {selectedInvoice && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-600" />
                  <div>
                    <p className="text-muted-foreground">رقم الفاتورة</p>
                    <p className="font-semibold">{selectedInvoice.invoice_number}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-blue-600" />
                  <div>
                    <p className="text-muted-foreground">العميل</p>
                    <p className="font-semibold">{selectedInvoice.customer?.name || 'غير محدد'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  <div>
                    <p className="text-muted-foreground">تاريخ الفاتورة</p>
                    <p className="font-semibold">
                      {new Date(selectedInvoice.invoice_date).toLocaleDateString('ar-SA')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-blue-600" />
                  <div>
                    <p className="text-muted-foreground">الإجمالي</p>
                    <p className="font-semibold">{selectedInvoice.total_amount.toFixed(2)} ريال</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Delivery Date */}
          <div className="space-y-2">
            <Label>تاريخ التسليم *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-right font-normal",
                    !deliveryDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="ml-2 h-4 w-4" />
                  {deliveryDate ? (
                    <span className="flex-1 text-right">{format(deliveryDate, 'dd/MM/yyyy')}</span>
                  ) : (
                    <span className="flex-1 text-right">اختر التاريخ</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={deliveryDate}
                  onSelect={(date) => date && setDeliveryDate(date)}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Delivery Lines */}
          {deliveryLines.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>بنود التسليم ({deliveryLines.length})</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="select-all"
                    checked={deliveryLines.every(line => line.selected || line.remaining_quantity === 0)}
                    onCheckedChange={handleSelectAll}
                  />
                  <label htmlFor="select-all" className="text-sm cursor-pointer">
                    تحديد الكل
                  </label>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-right w-12">اختر</th>
                      <th className="p-2 text-right">المنتج</th>
                      <th className="p-2 text-center">الكمية المطلوبة</th>
                      <th className="p-2 text-center">المسلّم</th>
                      <th className="p-2 text-center">المتبقي</th>
                      <th className="p-2 text-center">المتاح في المخزن</th>
                      <th className="p-2 text-center">الكمية للتسليم</th>
                      <th className="p-2 text-center">سعر الوحدة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {deliveryLines.map((line, index) => {
                      const canDeliver = line.remaining_quantity > 0 && line.available_stock > 0
                      const insufficientStock = line.remaining_quantity > line.available_stock

                      return (
                        <tr
                          key={line.invoice_line_id}
                          className={canDeliver ? '' : 'bg-muted/50'}
                        >
                          <td className="p-2 text-center">
                            <Checkbox
                              checked={line.selected}
                              onCheckedChange={(checked) => handleLineSelect(index, checked as boolean)}
                              disabled={!canDeliver}
                            />
                          </td>
                          <td className="p-2">
                            <div>
                              <p className="font-medium">{line.product_name}</p>
                              <p className="text-xs text-muted-foreground">{line.product_code}</p>
                            </div>
                          </td>
                          <td className="p-2 text-center font-medium">
                            {line.ordered_quantity}
                          </td>
                          <td className="p-2 text-center text-green-600">
                            {line.already_delivered}
                          </td>
                          <td className="p-2 text-center">
                            <Badge variant={line.remaining_quantity > 0 ? 'default' : 'secondary'}>
                              {line.remaining_quantity}
                            </Badge>
                          </td>
                          <td className="p-2 text-center">
                            <Badge variant={insufficientStock ? 'destructive' : 'outline'}>
                              {line.available_stock}
                            </Badge>
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min="0"
                              max={Math.min(line.remaining_quantity, line.available_stock)}
                              step="0.01"
                              value={line.quantity_to_deliver}
                              onChange={(e) => handleQuantityChange(index, e.target.value)}
                              disabled={!line.selected}
                              className="w-24 text-center"
                            />
                          </td>
                          <td className="p-2 text-center text-muted-foreground">
                            {line.unit_price.toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              {selectedCount > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-muted-foreground">البنود المحددة</p>
                      <p className="text-lg font-bold text-primary">{selectedCount} بند</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">القيمة الإجمالية</p>
                      <p className="text-2xl font-bold text-primary">{totalToDeliver.toFixed(2)} ريال</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات إضافية (اختياري)"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              onClick={handleSubmit}
              disabled={loading || selectedCount === 0}
              className="flex-1"
            >
              {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              إنشاء مذكرة التسليم
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              إلغاء
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
