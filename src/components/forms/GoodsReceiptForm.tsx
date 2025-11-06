import { useState, useEffect } from 'react'
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
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function GoodsReceiptForm({ open, onOpenChange, onSuccess }: GoodsReceiptFormProps) {
  const [loading, setLoading] = useState(false)
  const [loadingPOs, setLoadingPOs] = useState(false)
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([])
  const [selectedPO, setSelectedPO] = useState('')
  const [receiptDate, setReceiptDate] = useState<Date>(new Date())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<GoodsReceiptLine[]>([])

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
    
    const selectedLines = lines.filter(l => l.is_selected && getRemainingQuantity(l) > 0)
    
    if (selectedLines.length === 0) {
      toast.error('الرجاء اختيار منتج واحد على الأقل للاستلام')
      return
    }
    
    setLoading(true)
    
    try {
      const orgId = '00000000-0000-0000-0000-000000000001' // TODO: Get from auth context
      
      // Generate GR number
      const grNumber = `GR-${Date.now()}`
      
      // Create goods receipt
      const { data: gr, error: grError } = await supabase
        .from('goods_receipts')
        .insert({
          org_id: orgId,
          gr_number: grNumber,
          purchase_order_id: selectedPO,
          receipt_date: format(receiptDate, 'yyyy-MM-dd'),
          status: 'draft',
          notes: notes || null
        })
        .select()
        .single()
      
      if (grError) throw grError
      
      // Create receipt lines
      const grLines = selectedLines.map(line => ({
        org_id: orgId,
        goods_receipt_id: gr.id,
        po_line_id: line.po_line_id,
        product_id: line.product_id,
        quantity_received: getRemainingQuantity(line),
        unit_cost: line.unit_cost
      }))
      
      const { error: linesError } = await supabase
        .from('goods_receipt_lines')
        .insert(grLines)
      
      if (linesError) throw linesError
      
      // Update received quantities in PO lines
      for (const line of selectedLines) {
        const newReceivedQty = line.received_quantity + getRemainingQuantity(line)
        
        const { error: updateError } = await supabase
          .from('purchase_order_lines')
          .update({ 
            received_quantity: newReceivedQty
          })
          .eq('id', line.po_line_id)
        
        if (updateError) throw updateError
      }
      
      // Check if all lines are fully received
      const { data: allLines } = await supabase
        .from('purchase_order_lines')
        .select('quantity, received_quantity')
        .eq('purchase_order_id', selectedPO)
      
      const fullyReceived = allLines?.every(l => 
        (l.received_quantity || 0) >= l.quantity
      )
      
      // Update PO status
      const newStatus = fullyReceived ? 'fully_received' : 'partially_received'
      await supabase
        .from('purchase_orders')
        .update({ status: newStatus })
        .eq('id', selectedPO)
      
      // Update inventory using AVCO
      for (const line of selectedLines) {
        const qtyReceived = getRemainingQuantity(line)
        
        // Get current product data
        const { data: product } = await supabase
          .from('products')
          .select('stock_quantity, cost_price')
          .eq('id', line.product_id)
          .single()
        
        if (product) {
          const oldQty = product.stock_quantity || 0
          const oldCost = product.cost_price || 0
          const newQty = oldQty + qtyReceived
          const totalValue = (oldQty * oldCost) + (qtyReceived * line.unit_cost)
          const newAvgCost = newQty > 0 ? totalValue / newQty : line.unit_cost
          
          await supabase
            .from('products')
            .update({
              stock_quantity: newQty,
              cost_price: newAvgCost
            })
            .eq('id', line.product_id)
        }
      }
      
      toast.success(`تم إنشاء إشعار الاستلام ${grNumber} بنجاح`)
      onOpenChange(false)
      resetForm()
      onSuccess?.()
      
    } catch (error: any) {
      console.error('Error creating goods receipt:', error)
      toast.error(`خطأ في إنشاء إشعار الاستلام: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setSelectedPO('')
    setReceiptDate(new Date())
    setNotes('')
    setLines([])
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
                  <SelectValue placeholder={
                    loadingPOs 
                      ? 'جاري التحميل...' 
                      : purchaseOrders.length === 0 
                        ? 'لا توجد أوامر شراء متاحة' 
                        : 'اختر أمر الشراء'
                  } />
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
                    initialFocus
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
                      {lines.map((line, index) => {
                        const remaining = getRemainingQuantity(line)
                        return (
                          <tr key={index} className="border-t">
                            <td className="p-2 text-center">
                              <Checkbox
                                checked={line.is_selected}
                                disabled={remaining <= 0}
                                onCheckedChange={(checked) => 
                                  updateLine(index, 'is_selected', !!checked)
                                }
                              />
                            </td>
                            <td className="p-2">
                              <div>
                                <p className="font-medium">{line.product_name}</p>
                                <p className="text-sm text-muted-foreground">{line.product_code}</p>
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
