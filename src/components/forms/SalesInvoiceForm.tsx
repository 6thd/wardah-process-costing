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
import { Plus, Trash2, CalendarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { customersService } from '@/services/supabase-service'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface SalesInvoiceLine {
  id?: string
  product_id: string
  product_code?: string
  product_name?: string
  description?: string
  quantity: number
  unit_price: number
  discount_percentage: number
  tax_rate: number
  line_total: number
}

interface SalesInvoiceFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function SalesInvoiceForm({ open, onOpenChange, onSuccess }: SalesInvoiceFormProps) {
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [invoiceDate, setInvoiceDate] = useState<Date>(new Date())
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<SalesInvoiceLine[]>([
    {
      product_id: '',
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      tax_rate: 15,
      line_total: 0
    }
  ])

  useEffect(() => {
    if (open) {
      loadCustomers()
      loadProducts()
    }
  }, [open])

  const loadCustomers = async () => {
    try {
      const data = await customersService.getAll()
      setCustomers(data || [])
    } catch (error) {
      console.error('Error loading customers:', error)
      toast.error('خطأ في تحميل العملاء')
    }
  }

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name')
      
      if (error) throw error
      setProducts(data || [])
    } catch (error) {
      console.error('Error loading products:', error)
      toast.error('خطأ في تحميل المنتجات')
    }
  }

  const addLine = () => {
    setLines([...lines, {
      product_id: '',
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      tax_rate: 15,
      line_total: 0
    }])
  }

  const removeLine = (index: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== index))
    }
  }

  const updateLine = (index: number, field: keyof SalesInvoiceLine, value: any) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }
    
    // Auto-fill product details
    if (field === 'product_id' && value) {
      const product = products.find(p => p.id === value)
      if (product) {
        newLines[index].product_code = product.code
        newLines[index].product_name = product.name
        newLines[index].unit_price = product.selling_price || product.price || 0
      }
    }
    
    // Calculate line total
    const line = newLines[index]
    const subtotal = line.quantity * line.unit_price
    const discount = subtotal * (line.discount_percentage / 100)
    const afterDiscount = subtotal - discount
    const tax = afterDiscount * (line.tax_rate / 100)
    newLines[index].line_total = afterDiscount + tax
    
    setLines(newLines)
  }

  const calculateTotals = () => {
    const subtotal = lines.reduce((sum, line) => {
      const lineSubtotal = line.quantity * line.unit_price
      const discount = lineSubtotal * (line.discount_percentage / 100)
      return sum + (lineSubtotal - discount)
    }, 0)
    
    const discountAmount = lines.reduce((sum, line) => {
      const lineSubtotal = line.quantity * line.unit_price
      return sum + (lineSubtotal * (line.discount_percentage / 100))
    }, 0)
    
    const taxAmount = lines.reduce((sum, line) => {
      const lineSubtotal = line.quantity * line.unit_price
      const discount = lineSubtotal * (line.discount_percentage / 100)
      const afterDiscount = lineSubtotal - discount
      return sum + (afterDiscount * (line.tax_rate / 100))
    }, 0)
    
    const total = subtotal + taxAmount
    
    return { subtotal, discountAmount, taxAmount, total }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedCustomer) {
      toast.error('الرجاء اختيار العميل')
      return
    }
    
    if (lines.length === 0 || !lines[0].product_id) {
      toast.error('الرجاء إضافة منتج واحد على الأقل')
      return
    }
    
    setLoading(true)
    
    try {
      const { subtotal, discountAmount, taxAmount, total } = calculateTotals()
      const orgId = '00000000-0000-0000-0000-000000000001' // TODO: Get from auth context
      
      // Generate invoice number
      const invoiceNumber = `SI-${Date.now()}`
      
      // Create sales invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('sales_invoices')
        .insert({
          org_id: orgId,
          invoice_number: invoiceNumber,
          customer_id: selectedCustomer,
          invoice_date: format(invoiceDate, 'yyyy-MM-dd'),
          due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
          status: 'draft',
          subtotal: subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total_amount: total,
          notes: notes || null
        })
        .select()
        .single()
      
      if (invoiceError) throw invoiceError
      
      // Create invoice lines
      const invoiceLines = lines.map((line, index) => ({
        org_id: orgId,
        invoice_id: invoice.id,
        line_number: index + 1,
        product_id: line.product_id,
        description: line.description || null,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount_percentage: line.discount_percentage,
        tax_rate: line.tax_rate
        // line_total is a generated column - don't include it
      }))
      
      const { error: linesError } = await supabase
        .from('sales_invoice_lines')
        .insert(invoiceLines)
      
      if (linesError) throw linesError
      
      toast.success(`تم إنشاء فاتورة المبيعات ${invoiceNumber} بنجاح`)
      onOpenChange(false)
      resetForm()
      onSuccess?.()
      
    } catch (error: any) {
      console.error('Error creating sales invoice:', error)
      toast.error(`خطأ في إنشاء فاتورة المبيعات: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setSelectedCustomer('')
    setInvoiceDate(new Date())
    setDueDate(undefined)
    setNotes('')
    setLines([{
      product_id: '',
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      tax_rate: 15,
      line_total: 0
    }])
  }

  const { subtotal, discountAmount, taxAmount, total } = calculateTotals()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة فاتورة مبيعات جديدة</DialogTitle>
          <DialogDescription>
            قم بإدخال بيانات فاتورة المبيعات والمنتجات المباعة
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Header Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer">العميل *</Label>
              <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                <SelectTrigger id="customer">
                  <SelectValue placeholder="اختر العميل" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.code} - {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoiceDate">تاريخ الفاتورة *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="invoiceDate"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-right font-normal",
                      !invoiceDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {invoiceDate ? (
                      <span className="flex-1 text-right">{format(invoiceDate, 'dd/MM/yyyy')}</span>
                    ) : (
                      <span className="flex-1 text-right">اختر التاريخ</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={invoiceDate}
                    onSelect={(date) => date && setInvoiceDate(date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueDate">تاريخ الاستحقاق</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="dueDate"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-right font-normal",
                      !dueDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {dueDate ? (
                      <span className="flex-1 text-right">{format(dueDate, 'dd/MM/yyyy')}</span>
                    ) : (
                      <span className="flex-1 text-right">اختر التاريخ</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    disabled={(date) => date < invoiceDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">ملاحظات</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أي ملاحظات إضافية"
              />
            </div>
          </div>

          {/* Lines Section */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">المنتجات</h3>
              <Button type="button" onClick={addLine} size="sm" variant="outline">
                <Plus className="h-4 w-4 ml-2" />
                إضافة سطر
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-right p-2 text-sm font-medium">المنتج</th>
                      <th className="text-right p-2 text-sm font-medium w-24">الكمية</th>
                      <th className="text-right p-2 text-sm font-medium w-28">السعر</th>
                      <th className="text-right p-2 text-sm font-medium w-24">خصم %</th>
                      <th className="text-right p-2 text-sm font-medium w-24">ضريبة %</th>
                      <th className="text-right p-2 text-sm font-medium w-28">الإجمالي</th>
                      <th className="text-center p-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <tr key={index} className="border-t">
                        <td className="p-2">
                          <Select
                            value={line.product_id}
                            onValueChange={(value) => updateLine(index, 'product_id', value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="اختر المنتج" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.code} - {product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min="1"
                            value={line.quantity}
                            onChange={(e) => updateLine(index, 'quantity', parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.unit_price}
                            onChange={(e) => updateLine(index, 'unit_price', parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={line.discount_percentage}
                            onChange={(e) => updateLine(index, 'discount_percentage', parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={line.tax_rate}
                            onChange={(e) => updateLine(index, 'tax_rate', parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="p-2 text-right font-medium">
                          {line.line_total.toFixed(2)}
                        </td>
                        <td className="p-2 text-center">
                          {lines.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLine(index)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals Summary */}
            <div className="flex justify-end">
              <div className="w-80 space-y-2 border rounded-lg p-4 bg-muted/50">
                <div className="flex justify-between text-sm">
                  <span>الإجمالي الفرعي:</span>
                  <span className="font-medium">{subtotal.toFixed(2)} ر.س</span>
                </div>
                <div className="flex justify-between text-sm text-red-600">
                  <span>الخصم:</span>
                  <span className="font-medium">-{discountAmount.toFixed(2)} ر.س</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>الضريبة:</span>
                  <span className="font-medium">{taxAmount.toFixed(2)} ر.س</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>الإجمالي:</span>
                  <span className="text-primary">{total.toFixed(2)} ر.س</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              إلغاء
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'جاري الحفظ...' : 'حفظ الفاتورة'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
