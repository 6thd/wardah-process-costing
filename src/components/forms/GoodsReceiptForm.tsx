import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { CalendarIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { WarehouseSelector } from '@/components/ui/warehouse-selector'
import { StockBalanceInline } from '@/components/ui/stock-balance-badge'
import { receiveGoods } from '@/services/purchasing-service'

interface GoodsReceiptLine {
  po_line_id: string
  product_id: string
  product_code?: string
  product_name?: string
  ordered_quantity: number
  received_quantity: number
  unit_cost: number
  is_selected: boolean
}

interface GoodsReceiptFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess?: () => void
}

export function GoodsReceiptForm({ open, onOpenChange, onSuccess }: GoodsReceiptFormProps) {
  const [loading, setLoading] = useState(false)
  const [loadingPOs, setLoadingPOs] = useState(false)
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([])
  const [selectedPO, setSelectedPO] = useState('')
  const [warehouseId, setWarehouseId] = useState('')  // ⭐ New: Warehouse selection
  const [receiptDate, setReceiptDate] = useState<Date>(new Date())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<GoodsReceiptLine[]>([])
  // مفتاح idempotency ثابت لمحاولة الاستلام الواحدة: يُنشأ مرة ويُعاد استخدامه عبر
  // إعادة المحاولة بعد فشل/timeout فلا يتكرر الاستلام؛ يُصفَّر بعد النجاح فقط.
  const idempotencyKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (open) {
      loadPurchaseOrders()
    }
  }, [open])

  useEffect(() => {
    if (selectedPO) {
      loadPOLines()
    }
  }, [selectedPO])

  const loadPurchaseOrders = async () => {
    setLoadingPOs(true)
    try {
      console.log('🔍 Loading purchase orders for goods receipt...')
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          vendor:vendors(code, name)
        `)
        .in('status', ['confirmed', 'partially_received', 'draft'])
        .order('order_date', { ascending: false })
      
      if (error) throw error
      console.log('✅ Found', data?.length || 0, 'purchase orders:', data)
      setPurchaseOrders(data || [])
      
      if (!data || data.length === 0) {
        toast.info('لا توجد أوامر شراء جاهزة للاستلام')
      }
    } catch (error) {
      console.error('💥 Error loading purchase orders:', error)
      toast.error('خطأ في تحميل أوامر الشراء')
    } finally {
      setLoadingPOs(false)
    }
  }

  const loadPOLines = async () => {
    try {
      const { data, error } = await supabase
        .from('purchase_order_lines')
        .select(`
          *,
          product:products(code, name)
        `)
        .eq('purchase_order_id', selectedPO)
        .order('line_number')
      
      if (error) throw error
      
      const receiptLines: GoodsReceiptLine[] = (data || []).map(line => ({
        po_line_id: line.id,
        product_id: line.product_id,
        product_code: line.product?.code,
        product_name: line.product?.name,
        ordered_quantity: line.quantity,
        received_quantity: line.received_quantity || 0,
        unit_cost: line.unit_price,
        is_selected: true
      }))
      
      setLines(receiptLines)
    } catch (error) {
      console.error('Error loading PO lines:', error)
      toast.error('خطأ في تحميل أسطر أمر الشراء')
    }
  }

  const updateLine = (index: number, field: keyof GoodsReceiptLine, value: any) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }
    setLines(newLines)
  }

  const getRemainingQuantity = (line: GoodsReceiptLine) => {
    return line.ordered_quantity - line.received_quantity
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedPO) {
      toast.error('الرجاء اختيار أمر الشراء')
      return
    }

    // ⭐ Validate warehouse selection
    if (!warehouseId) {
      toast.error('الرجاء اختيار المخزن')
      return
    }
    
    const selectedLines = lines.filter(l => l.is_selected && getRemainingQuantity(l) > 0)
    
    if (selectedLines.length === 0) {
      toast.error('الرجاء اختيار منتج واحد على الأقل للاستلام')
      return
    }
    
    setLoading(true)
    
    try {
      console.log('📦 Creating Goods Receipt with Stock Ledger System...')

      // Get PO details for vendor_id
      const po = purchaseOrders.find(p => p.id === selectedPO)
      if (!po) {
        throw new Error('Purchase Order not found')
      }

      // Prepare receipt data
      const receipt = {
        purchase_order_id: selectedPO,
        vendor_id: po.vendor_id,
        receipt_date: format(receiptDate, 'yyyy-MM-dd'),
        warehouse_id: warehouseId,  // ⭐ Required for Stock Ledger
        notes: notes || undefined
      }

      // Prepare lines data
      const receiptLines = selectedLines.map(line => ({
        product_id: line.product_id,
        purchase_order_line_id: line.po_line_id,  // ⭐ Link to PO line
        ordered_quantity: line.ordered_quantity,
        received_quantity: getRemainingQuantity(line),
        unit_cost: line.unit_cost,
        quality_status: 'accepted' as const  // Default to accepted
      }))

      // ⭐ Use the new receiveGoods function with Stock Ledger System.
      //    مفتاح idempotency ثابت عبر إعادة المحاولة (يُنشأ مرة لهذه المحاولة).
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = globalThis.crypto.randomUUID()
      }
      const result = await receiveGoods(receipt, receiptLines, idempotencyKeyRef.current)

      if (!result.success) {
        throw result.error || new Error('Failed to create goods receipt')
      }

      console.log('✅ Goods Receipt created successfully:', result.data)

      toast.success('تم إنشاء سند الاستلام بنجاح')

      // نجح الاستلام ⇒ صفّر المفتاح ليبدأ الاستلام التالي بمفتاح جديد
      idempotencyKeyRef.current = null

      // B1: قيد GL لم يُرحَّل؟ أخبر المستخدم بدل الصمت
      if (result.glWarning) {
        toast.warning(result.glWarning, { duration: 10000 })
      }

      // Reset form
      setSelectedPO('')
      setWarehouseId('')
      setNotes('')
      setLines([])
      
      if (onSuccess) onSuccess()
      onOpenChange(false)
      
    } catch (error: any) {
      console.error('❌ Error creating goods receipt:', error)
      toast.error(`خطأ في إنشاء سند الاستلام: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const selectedPODetails = purchaseOrders.find(po => po.id === selectedPO)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة إشعار استلام بضاعة</DialogTitle>
          <DialogDescription>
            اختر أمر الشراء وحدد الكميات المستلمة
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Header Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchaseOrder">أمر الشراء *</Label>
              <Select value={selectedPO} onValueChange={setSelectedPO} disabled={loadingPOs}>
                <SelectTrigger id="purchaseOrder">
                  <SelectValue placeholder={(() => {
                    if (loadingPOs) return 'جاري التحميل...'
                    if (purchaseOrders.length === 0) return 'لا توجد أوامر شراء متاحة'
                    return 'اختر أمر الشراء'
                  })()} />
                </SelectTrigger>
                <SelectContent>
                  {purchaseOrders.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      <p className="font-semibold mb-2">لا توجد أوامر شراء جاهزة للاستلام</p>
                      <p className="text-xs">قد يكون السبب:</p>
                      <ul className="text-xs mt-1 space-y-1 text-right">
                        <li>• لا توجد أوامر شراء مؤكدة</li>
                        <li>• جميع الأوامر تم استلامها بالكامل</li>
                      </ul>
                    </div>
                  ) : (
                    purchaseOrders.map((po) => (
                      <SelectItem key={po.id} value={po.id}>
                        {po.order_number} - {po.vendor?.name} ({po.total_amount.toFixed(2)} ر.س)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {loadingPOs && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  جاري تحميل أوامر الشراء...
                </p>
              )}
              {!loadingPOs && purchaseOrders.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  تم العثور على {purchaseOrders.length} {purchaseOrders.length === 1 ? 'أمر شراء' : 'أوامر شراء'}
                </p>
              )}
            </div>

            {/* ⭐ Warehouse Selector - Required for Stock Ledger System */}
            <div className="space-y-2">
              <WarehouseSelector 
                value={warehouseId} 
                onChange={setWarehouseId}
                required
                disabled={!selectedPO}
                label="المخزن *"
                showLabel={true}
              />
              {selectedPO && !warehouseId && (
                <p className="text-xs text-red-600">
                  يجب اختيار المخزن لإنشاء سند الاستلام
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="receiptDate">تاريخ الاستلام *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="receiptDate"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-right font-normal",
                      !receiptDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {receiptDate ? (
                      <span className="flex-1 text-right">{format(receiptDate, 'dd/MM/yyyy')}</span>
                    ) : (
                      <span className="flex-1 text-right">اختر التاريخ</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={receiptDate}
                    onSelect={(date) => date && setReceiptDate(date)}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">ملاحظات</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أي ملاحظات عن الاستلام"
              />
            </div>
          </div>

          {/* PO Details */}
          {selectedPODetails && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">المورد:</span>
                  <p className="font-medium">{selectedPODetails.vendor?.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">تاريخ الأمر:</span>
                  <p className="font-medium">
                    {new Date(selectedPODetails.order_date).toLocaleDateString('ar-SA')}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">الحالة:</span>
                  <p className="font-medium">{selectedPODetails.status}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">الإجمالي:</span>
                  <p className="font-medium">{selectedPODetails.total_amount.toFixed(2)} ر.س</p>
                </div>
              </div>
            </div>
          )}

          {/* Lines Section */}
          {lines.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">المنتجات المطلوب استلامها</h3>

              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-center p-2 w-12">
                          <Checkbox
                            checked={lines.every(l => l.is_selected)}
                            onCheckedChange={(checked) => {
                              setLines(lines.map(l => ({ ...l, is_selected: !!checked })))
                            }}
                          />
                        </th>
                        <th className="text-right p-2 text-sm font-medium">المنتج</th>
                        <th className="text-right p-2 text-sm font-medium w-24">المطلوب</th>
                        <th className="text-right p-2 text-sm font-medium w-24">تم استلامه</th>
                        <th className="text-right p-2 text-sm font-medium w-24">المتبقي</th>
                        <th className="text-right p-2 text-sm font-medium w-28">التكلفة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, lineIndex) => {
                        const remaining = getRemainingQuantity(line)
                        const lineKey = `${line.po_line_id}-${line.product_id}`
                        return (
                          <tr key={lineKey} className="border-t">
                            <td className="p-2 text-center">
                              <Checkbox
                                checked={line.is_selected}
                                disabled={remaining <= 0}
                                onCheckedChange={(checked) => 
                                  updateLine(lineIndex, 'is_selected', !!checked)
                                }
                              />
                            </td>
                            <td className="p-2">
                              <div>
                                <p className="font-medium">{line.product_name}</p>
                                <p className="text-sm text-muted-foreground">{line.product_code}</p>
                                {/* ⭐ Show current stock balance if warehouse is selected */}
                                {warehouseId && (
                                  <div className="mt-1">
                                    <StockBalanceInline 
                                      productId={line.product_id} 
                                      warehouseId={warehouseId}
                                    />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="p-2 text-right font-medium">
                              {line.ordered_quantity}
                            </td>
                            <td className="p-2 text-right text-green-600 font-medium">
                              {line.received_quantity}
                            </td>
                            <td className="p-2 text-right">
                              <span className={remaining > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>
                                {remaining}
                              </span>
                            </td>
                            <td className="p-2 text-right font-medium">
                              {line.unit_cost.toFixed(2)} ر.س
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end">
                <div className="text-sm text-muted-foreground">
                  سيتم استلام جميع الكميات المتبقية للمنتجات المحددة
                </div>
              </div>
            </div>
          )}

          {lines.length === 0 && selectedPO && (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد أسطر لهذا الأمر أو تم استلام جميع المنتجات
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              إلغاء
            </Button>
            <Button type="submit" disabled={loading || lines.length === 0}>
              {loading ? 'جاري الحفظ...' : 'تأكيد الاستلام'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
