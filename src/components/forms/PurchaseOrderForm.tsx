import { useState, useEffect, useRef, useMemo } from 'react'
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
import { 
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Plus, Trash2, X, CalendarIcon, Check, ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { vendorsService } from '@/services/supabase-service'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { loadRawMaterials } from '@/lib/product-utils'

// Custom hook for debouncing search terms
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

interface PurchaseOrderLine {
  id?: string
  product_id: string
  product_code?: string
  product_name?: string
  description?: string
  quantity: number
  unit_price: number
  discount_percentage: number
  tax_percentage: number
  line_total: number
}

interface PurchaseOrderFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function PurchaseOrderForm({ open, onOpenChange, onSuccess }: PurchaseOrderFormProps) {
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedVendor, setSelectedVendor] = useState('')
  const [orderDate, setOrderDate] = useState<Date>(new Date())
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<Date | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [searchTerms, setSearchTerms] = useState<{ [key: number]: string }>({})
  const debouncedSearchTerms = useDebouncedValue(searchTerms, 300)
  const [openDropdowns, setOpenDropdowns] = useState<{ [key: number]: boolean }>({})
  const inputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({})
  const rowRefs = useRef<{ [key: number]: HTMLTableRowElement | null }>({})
  const tableContainerRef = useRef<HTMLDivElement | null>(null)
  const [lines, setLines] = useState<PurchaseOrderLine[]>([
    {
      product_id: '',
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      tax_percentage: 15,
      line_total: 0
    }
  ])

  useEffect(() => {
    if (open) {
      loadVendors()
      loadProducts()
    }
  }, [open])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.product-search-dropdown')) {
        setOpenDropdowns({})
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadVendors = async () => {
    try {
      const data = await vendorsService.getAll()
      setVendors(data || [])
    } catch (error) {
      console.error('Error loading vendors:', error)
      toast.error('خطأ في تحميل الموردين')
    }
  }

  const loadProducts = async () => {
    try {
      // Load only Raw Materials for purchase orders
      const rawMaterials = await loadRawMaterials()
      console.log('✅ Loaded', rawMaterials.length, 'raw materials for purchase')
      setProducts(rawMaterials)
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
      tax_percentage: 15,
      line_total: 0
    }])
  }

  const removeLine = (index: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== index))
    }
  }

  const updateLine = (index: number, field: keyof PurchaseOrderLine, value: any) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }
    
    // Auto-fill product details
    if (field === 'product_id' && value) {
      const product = products.find(p => p.id === value)
      if (product) {
        newLines[index].product_code = product.code
        newLines[index].product_name = product.name
        newLines[index].unit_price = product.cost_price || 0
      }
    }
    
    // Calculate line total
    const line = newLines[index]
    const subtotal = line.quantity * line.unit_price
    const discount = subtotal * (line.discount_percentage / 100)
    const afterDiscount = subtotal - discount
    const tax = afterDiscount * (line.tax_percentage / 100)
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
      return sum + (afterDiscount * (line.tax_percentage / 100))
    }, 0)
    
    const total = subtotal + taxAmount
    
    return { subtotal, discountAmount, taxAmount, total }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedVendor) {
      toast.error('الرجاء اختيار المورد')
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
      
      // Generate order number
      const orderNumber = `PO-${Date.now()}`
      
      // Create purchase order
      const { data: order, error: orderError } = await supabase
        .from('purchase_orders')
        .insert({
          org_id: orgId,
          order_number: orderNumber,
          vendor_id: selectedVendor,
          order_date: format(orderDate, 'yyyy-MM-dd'),
          expected_delivery_date: expectedDeliveryDate ? format(expectedDeliveryDate, 'yyyy-MM-dd') : null,
          status: 'draft',
          subtotal: subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total_amount: total,
          notes: notes || null
        })
        .select()
        .single()
      
      if (orderError) throw orderError
      
      // Create order lines
      const orderLines = lines.map((line, index) => ({
        org_id: orgId,
        purchase_order_id: order.id,
        line_number: index + 1,
        product_id: line.product_id,
        description: line.description || null,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount_percentage: line.discount_percentage,
        tax_percentage: line.tax_percentage
        // line_total is a generated column - don't include it
      }))
      
      const { error: linesError } = await supabase
        .from('purchase_order_lines')
        .insert(orderLines)
      
      if (linesError) throw linesError
      
      toast.success(`تم إنشاء أمر الشراء ${orderNumber} بنجاح`)
      onOpenChange(false)
      resetForm()
      onSuccess?.()
      
    } catch (error: any) {
      console.error('Error creating purchase order:', error)
      toast.error(`خطأ في إنشاء أمر الشراء: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setSelectedVendor('')
    setOrderDate(new Date())
    setExpectedDeliveryDate(undefined)
    setNotes('')
    setLines([{
      product_id: '',
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      tax_percentage: 15,
      line_total: 0
    }])
  }

  const { subtotal, discountAmount, taxAmount, total } = calculateTotals()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة أمر شراء جديد</DialogTitle>
          <DialogDescription>
            قم بإدخال بيانات أمر الشراء والمنتجات المطلوبة
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Header Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vendor">المورد *</Label>
              <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                <SelectTrigger id="vendor">
                  <SelectValue placeholder="اختر المورد" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.code} - {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="orderDate">تاريخ الأمر *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="orderDate"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-right font-normal",
                      !orderDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {orderDate ? (
                      <span className="flex-1 text-right">{format(orderDate, 'dd/MM/yyyy')}</span>
                    ) : (
                      <span className="flex-1 text-right">اختر التاريخ</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={orderDate}
                    onSelect={(date) => date && setOrderDate(date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deliveryDate">تاريخ التسليم المتوقع</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="deliveryDate"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-right font-normal",
                      !expectedDeliveryDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {expectedDeliveryDate ? (
                      <span className="flex-1 text-right">{format(expectedDeliveryDate, 'dd/MM/yyyy')}</span>
                    ) : (
                      <span className="flex-1 text-right">اختر التاريخ</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={expectedDeliveryDate}
                    onSelect={setExpectedDeliveryDate}
                    disabled={(date) => date < orderDate}
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

            <div className="border rounded-lg" ref={tableContainerRef}>
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
                    {lines.map((line, index) => {
                      const selectedProduct = products.find(p => p.id === line.product_id)
                      const searchTerm = searchTerms[index] || ''
                      const debouncedSearchTerm = debouncedSearchTerms[index] || ''
                      const filteredProducts = products.filter(p => 
                        p.code.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                        p.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
                      )
                      
                      return (
                      <tr key={index} className="border-t" ref={(el) => rowRefs.current[index] = el}>
                        <td className="p-2 relative">
                          <div className="relative product-search-dropdown min-w-[300px]">
                            <Input
                              ref={(el) => inputRefs.current[index] = el}
                              placeholder="🔍 ابحث بالكود أو الاسم..."
                              value={searchTerm}
                              onChange={(e) => {
                                const newValue = e.target.value
                                setSearchTerms({...searchTerms, [index]: newValue})
                                console.log('🔍 Search:', newValue, 'Filtered:', filteredProducts.length)
                                // Open only this dropdown, close others
                                if (newValue.length > 0) {
                                  setOpenDropdowns({ [index]: true })
                                  console.log('📂 Dropdown opened for index:', index)
                                } else {
                                  setOpenDropdowns({})
                                }
                              }}
                              onFocus={() => {
                                // Open only this dropdown if there's text
                                if (searchTerm.length > 0) {
                                  setOpenDropdowns({ [index]: true })
                                }
                              }}
                              onBlur={(e) => {
                                // Check if focus moved to an element inside the dropdown
                                const currentTarget = e.currentTarget
                                // Delay to allow click events to fire on dropdown items
                                setTimeout(() => {
                                  // Only close if focus didn't move to a dropdown item
                                  if (!currentTarget.contains(document.activeElement)) {
                                    setOpenDropdowns(prev => {
                                      const newState = { ...prev }
                                      delete newState[index]
                                      return newState
                                    })
                                  }
                                }, 150)
                              }}
                              className="h-10 text-sm pr-10"
                            />
                            {selectedProduct && (
                              <div className="absolute left-2 top-2 text-xs text-green-600 font-semibold">
                                ✓ {selectedProduct.code}
                              </div>
                            )}
                          </div>
                          
                          {/* Dropdown Results - Positioned directly below the input */}
                          {openDropdowns[index] && filteredProducts.length > 0 && (
                            <div 
                              style={{
                                position: 'fixed',
                                top: inputRefs.current[index] ? inputRefs.current[index]!.getBoundingClientRect().bottom : 0,
                                left: inputRefs.current[index] ? inputRefs.current[index]!.getBoundingClientRect().left : 0,
                                width: inputRefs.current[index] ? inputRefs.current[index]!.getBoundingClientRect().width : 300,
                              }}
                              className="z-[9999] bg-white dark:bg-slate-900 border-2 border-blue-500 rounded-md shadow-2xl max-h-60 overflow-auto"
                            >
                              <div className="p-2 bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-600 font-semibold border-b">
                                {filteredProducts.length} نتيجة
                              </div>
                              {filteredProducts.slice(0, 20).map((product) => (
                                <div
                                  key={product.id}
                                  className="px-3 py-3 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-b border-slate-100 dark:border-slate-800 last:border-0"
                                  onClick={() => {
                                    console.log('✅ Product clicked:', product.name)
                                    updateLine(index, 'product_id', product.id)
                                    updateLine(index, 'product_code', product.code)
                                    updateLine(index, 'product_name', product.name)
                                    updateLine(index, 'unit_price', product.cost_price || 0)
                                    setSearchTerms({...searchTerms, [index]: product.code + ' - ' + product.name})
                                    setOpenDropdowns({})
                                  }}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-sm text-blue-600">{product.code}</span>
                                    <span className="font-medium text-sm">{product.name}</span>
                                    <span className="text-xs text-green-600 font-semibold mt-1">
                                      💰 {product.cost_price?.toFixed(2) || 0} ر.س
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          
                          {/* No results message */}
                          {openDropdowns[index] && debouncedSearchTerm.length > 0 && filteredProducts.length === 0 && (
                            <div 
                              style={{
                                position: 'fixed',
                                top: inputRefs.current[index] ? inputRefs.current[index]!.getBoundingClientRect().bottom : 0,
                                left: inputRefs.current[index] ? inputRefs.current[index]!.getBoundingClientRect().left : 0,
                                width: inputRefs.current[index] ? inputRefs.current[index]!.getBoundingClientRect().width : 300,
                              }}
                              className="z-[9999] bg-white dark:bg-slate-900 border-2 border-red-500 rounded-md shadow-2xl p-4 text-center"
                            >
                              <div className="text-red-600 font-semibold">❌ لا توجد نتائج</div>
                              <div className="text-sm text-muted-foreground mt-1">للبحث: "{debouncedSearchTerm}"</div>
                            </div>
                          )}
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
                            value={line.tax_percentage}
                            onChange={(e) => updateLine(index, 'tax_percentage', parseFloat(e.target.value) || 0)}
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
                    )})}
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
              {loading ? 'جاري الحفظ...' : 'حفظ أمر الشراء'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
