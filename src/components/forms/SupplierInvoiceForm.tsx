import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Loader2, Package, Truck, Calendar, DollarSign, CalendarIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { loadPurchasableProducts } from '@/lib/product-utils'

interface SupplierInvoiceFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface Vendor {
  id: string
  code: string
  name: string
}

interface PurchaseOrder {
  id: string
  order_number: string
  order_date: string
  vendor_id: string
  status: string
  total_amount: number
  vendor?: {
    code: string
    name: string
  }
}

interface POLine {
  id: string
  product_id: string
  quantity: number
  invoiced_quantity: number
  unit_price: number
  discount_amount: number
  tax_amount: number
  line_total: number
  product?: {
    id: string
    code: string
    name: string
  }
}

interface InvoiceLine {
  po_line_id: string
  product_id: string
  product_name: string
  product_code: string
  ordered_quantity: number
  already_invoiced: number
  remaining_quantity: number
  quantity_to_invoice: number
  unit_price: number
  discount_amount: number
  tax_rate: number
  selected: boolean
}

export function SupplierInvoiceForm({ open, onOpenChange, onSuccess }: SupplierInvoiceFormProps) {
  const [loading, setLoading] = useState(false)
  const [loadingVendors, setLoadingVendors] = useState(true)
  const [loadingPOs, setLoadingPOs] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [createMode, setCreateMode] = useState<'with-po' | 'without-po'>('with-po')
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [availablePOs, setAvailablePOs] = useState<PurchaseOrder[]>([])
  const [selectedPOId, setSelectedPOId] = useState('')
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null)
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([])
  const [invoiceDate, setInvoiceDate] = useState<Date>(new Date())
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [availableProducts, setAvailableProducts] = useState<any[]>([])

  // Load vendors when dialog opens
  useEffect(() => {
    if (open) {
      loadVendors()
    }
  }, [open])

  // Load POs when vendor is selected or mode changes to with-po
  useEffect(() => {
    console.log('📊 useEffect triggered:', { selectedVendorId, createMode })
    if (selectedVendorId && createMode === 'with-po') {
      console.log('✅ Conditions met, loading POs...')
      loadPurchaseOrders(selectedVendorId)
    } else {
      console.log('⚠️ Conditions NOT met:', { 
        hasVendor: !!selectedVendorId, 
        isWithPO: createMode === 'with-po' 
      })
      setAvailablePOs([])
      setSelectedPOId('')
    }
  }, [selectedVendorId, createMode])

  // Load PO lines when PO is selected
  useEffect(() => {
    if (selectedPOId) {
      loadPOLines(selectedPOId)
      // Generate invoice number automatically
      if (!invoiceNumber) {
        setInvoiceNumber(`PINV-${Date.now()}`)
      }
    } else {
      setInvoiceLines([])
      setSelectedPO(null)
    }
  }, [selectedPOId])

  const loadVendors = async () => {
    setLoadingVendors(true)
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('id, code, name')
        .order('name')

      if (error) throw error
      setVendors(data || [])
    } catch (error) {
      console.error('Error loading vendors:', error)
      toast.error('خطأ في تحميل الموردين')
    } finally {
      setLoadingVendors(false)
    }
  }

  const loadPurchaseOrders = async (vendorId: string) => {
    setLoadingPOs(true)
    try {
      console.log('🔍 Loading POs for vendor:', vendorId, 'in mode:', createMode)
      
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, vendor:vendors(code, name)')
        .eq('vendor_id', vendorId)
        .in('status', ['draft', 'confirmed', 'partially_invoiced', 'received', 'partially_received', 'fully_received'])
        .order('order_date', { ascending: false })

      if (error) {
        console.error('❌ Error loading POs:', error)
        throw error
      }
      
      console.log('✅ Found', data?.length || 0, 'POs:', data)
      setAvailablePOs(data || [])
      
      if (!data || data.length === 0) {
        console.warn('⚠️ No purchase orders found for vendor:', vendorId)
        toast.info('لا توجد أوامر شراء متاحة لهذا المورد')
      }
    } catch (error) {
      console.error('💥 Error loading purchase orders:', error)
      toast.error('خطأ في تحميل أوامر الشراء')
    } finally {
      setLoadingPOs(false)
    }
  }

  const loadPOLines = async (poId: string) => {
    setLoading(true)
    try {
      // Get PO details
      const po = availablePOs.find(p => p.id === poId)
      setSelectedPO(po || null)

      // Get PO lines with product details
      const { data, error } = await supabase
        .from('purchase_order_lines')
        .select('*, product:products(id, code, name)')
        .eq('purchase_order_id', poId)

      if (error) throw error

      // Transform to invoice lines
      const lines: InvoiceLine[] = (data || []).map((line: POLine) => {
        const orderedQty = line.quantity
        const alreadyInvoiced = line.invoiced_quantity || 0
        const remaining = orderedQty - alreadyInvoiced

        return {
          po_line_id: line.id,
          product_id: line.product_id,
          product_name: line.product?.name || 'منتج غير محدد',
          product_code: line.product?.code || '',
          ordered_quantity: orderedQty,
          already_invoiced: alreadyInvoiced,
          remaining_quantity: remaining,
          quantity_to_invoice: remaining, // Default to remaining
          unit_price: line.unit_price,
          discount_amount: line.discount_amount || 0,
          tax_rate: 15, // Default 15%
          selected: remaining > 0
        }
      })

      setInvoiceLines(lines)
    } catch (error) {
      console.error('Error loading PO lines:', error)
      toast.error('خطأ في تحميل بنود أمر الشراء')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectAll = (checked: boolean) => {
    setInvoiceLines(lines =>
      lines.map(line => ({
        ...line,
        selected: checked && line.remaining_quantity > 0
      }))
    )
  }

  const handleLineSelect = (index: number, checked: boolean) => {
    setInvoiceLines(lines =>
      lines.map((line, i) =>
        i === index ? { ...line, selected: checked } : line
      )
    )
  }

  // Helper function to convert Arabic numerals to English
  const toEnglishDigits = (str: string | number): string => {
    const value = typeof str === 'number' ? str.toString() : str
    return value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
  }

  const loadProducts = async () => {
    setLoadingProducts(true)
    try {
      const filteredProducts = await loadPurchasableProducts()
      setAvailableProducts(filteredProducts)
    } catch (error) {
      console.error('Error loading products:', error)
      toast.error('خطأ في تحميل المنتجات')
    } finally {
      setLoadingProducts(false)
    }
  }

  const handleQuantityChange = (index: number, value: string) => {
    const qty = parseFloat(value) || 0
    setInvoiceLines(lines =>
      lines.map((line, i) => {
        if (i === index) {
          return { ...line, quantity_to_invoice: Math.min(qty, line.remaining_quantity) }
        }
        return line
      })
    )
  }

  const calculateLineTotal = (line: InvoiceLine) => {
    const subtotal = line.quantity_to_invoice * line.unit_price
    const discount = line.discount_amount || 0
    const afterDiscount = subtotal - discount
    const tax = afterDiscount * (line.tax_rate / 100)
    return afterDiscount + tax
  }

  const handleSubmit = async () => {
    // Validation
    const selectedLines = invoiceLines.filter(line => line.selected)
    if (selectedLines.length === 0) {
      toast.error('الرجاء اختيار بند واحد على الأقل')
      return
    }

    // Validate all selected lines have products (for without-po mode)
    if (createMode === 'without-po') {
      const missingProduct = selectedLines.find(line => !line.product_id)
      if (missingProduct) {
        toast.error('الرجاء اختيار منتج لكل بند')
        return
      }
    }

    if (!invoiceNumber.trim()) {
      toast.error('الرجاء إدخال رقم الفاتورة')
      return
    }

    if (!invoiceDate) {
      toast.error('الرجاء إدخال تاريخ الفاتورة')
      return
    }

    if (!selectedVendorId) {
      toast.error('الرجاء اختيار مورد')
      return
    }

    setLoading(true)

    try {
      // Calculate totals
      let subtotal = 0
      let totalDiscount = 0
      let totalTax = 0

      selectedLines.forEach(line => {
        const lineSubtotal = line.quantity_to_invoice * line.unit_price
        const lineDiscount = line.discount_amount || 0
        const lineAfterDiscount = lineSubtotal - lineDiscount
        const lineTax = lineAfterDiscount * (line.tax_rate / 100)
        
        subtotal += lineSubtotal
        totalDiscount += lineDiscount
        totalTax += lineTax
      })

      const totalAmount = subtotal - totalDiscount + totalTax

      // 1. Create supplier invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('supplier_invoices')
        .insert({
          invoice_number: invoiceNumber,
          invoice_date: format(invoiceDate, 'yyyy-MM-dd'),
          due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
          vendor_id: selectedVendorId,
          purchase_order_id: selectedPOId || null,
          subtotal: subtotal,
          discount_amount: totalDiscount,
          tax_amount: totalTax,
          total_amount: totalAmount,
          status: 'pending',
          notes: notes || null
        })
        .select()
        .single()

      if (invoiceError) throw invoiceError

      // 2. Insert invoice lines
      for (const line of selectedLines) {
        if (line.quantity_to_invoice <= 0) continue

        const { error: lineError } = await supabase
          .from('supplier_invoice_lines')
          .insert({
            invoice_id: invoice.id,
            product_id: line.product_id,
            quantity: line.quantity_to_invoice,
            unit_price: line.unit_price,
            discount_amount: line.discount_amount || 0,
            tax_amount: (line.quantity_to_invoice * line.unit_price - (line.discount_amount || 0)) * (line.tax_rate / 100)
            // line_total is a generated column - don't include it
          })

        if (lineError) throw lineError

        // Update PO line invoiced_quantity (only if created from PO)
        if (createMode === 'with-po' && line.po_line_id && !line.po_line_id.startsWith('temp-')) {
          const { error: updateLineError } = await supabase
            .from('purchase_order_lines')
            .update({
              invoiced_quantity: line.already_invoiced + line.quantity_to_invoice
            })
            .eq('id', line.po_line_id)

          if (updateLineError) throw updateLineError
        }
      }

      // 3. Check if PO is fully invoiced (only if created from PO)
      if (createMode === 'with-po' && selectedPOId) {
        const { data: allLines, error: checkError } = await supabase
          .from('purchase_order_lines')
          .select('quantity, invoiced_quantity')
          .eq('purchase_order_id', selectedPOId)

        if (checkError) throw checkError

        const allFullyInvoiced = allLines.every(
          (line: any) => (line.invoiced_quantity || 0) >= line.quantity
        )

        const newPOStatus = allFullyInvoiced ? 'invoiced' : 'partially_invoiced'

        // 4. Update PO status
        const { error: updatePOError } = await supabase
          .from('purchase_orders')
          .update({ status: newPOStatus })
          .eq('id', selectedPOId)

        if (updatePOError) throw updatePOError
      }

      // 5. Create GL Entry (Journal Entry)
      await createGLEntry(invoice, selectedLines)

      toast.success(`تم إنشاء فاتورة المشتريات ${invoiceNumber} بنجاح`)
      onSuccess()
      resetForm()
      onOpenChange(false)
    } catch (error) {
      console.error('Error creating supplier invoice:', error)
      toast.error('خطأ في إنشاء فاتورة المشتريات')
    } finally {
      setLoading(false)
    }
  }

  const createGLEntry = async (invoice: any, lines: InvoiceLine[]) => {
    try {
      // Get GL accounts from mappings
      const { data: mappings, error: mappingsError } = await supabase
        .from('gl_mappings')
        .select('*')
        .eq('org_id', '00000000-0000-0000-0000-000000000001')

      if (mappingsError) throw mappingsError

      const inventoryAccountId = mappings?.find((m: any) => m.transaction_type === 'PURCHASE_INVENTORY')?.debit_account_id
      const taxAccountId = mappings?.find((m: any) => m.transaction_type === 'PURCHASE_TAX')?.debit_account_id
      const payableAccountId = mappings?.find((m: any) => m.transaction_type === 'PURCHASE_PAYABLE')?.credit_account_id

      if (!inventoryAccountId || !payableAccountId) {
        console.warn('GL mappings not configured for purchases')
        return
      }

      // Create GL Entry
      const entryNumber = `JE-PI-${Date.now()}`
      const { data: glEntry, error: entryError } = await supabase
        .from('gl_entries')
        .insert({
          entry_number: entryNumber,
          entry_date: invoice.invoice_date,
          description: `فاتورة مشتريات ${invoice.invoice_number}`,
          status: 'posted',
          source_type: 'PURCHASE_INVOICE',
          source_id: invoice.id
        })
        .select()
        .single()

      if (entryError) throw entryError

      // Debit: Inventory (or Purchases account)
      const inventoryAmount = invoice.subtotal - invoice.discount_amount
      await supabase
        .from('gl_entry_lines')
        .insert({
          entry_id: glEntry.id,
          account_id: inventoryAccountId,
          debit: inventoryAmount,
          credit: 0,
          description: `مشتريات - ${invoice.invoice_number}`
        })

      // Debit: Tax
      if (invoice.tax_amount > 0 && taxAccountId) {
        await supabase
          .from('gl_entry_lines')
          .insert({
            entry_id: glEntry.id,
            account_id: taxAccountId,
            debit: invoice.tax_amount,
            credit: 0,
            description: `ضريبة مشتريات - ${invoice.invoice_number}`
          })
      }

      // Credit: Accounts Payable
      await supabase
        .from('gl_entry_lines')
        .insert({
          entry_id: glEntry.id,
          account_id: payableAccountId,
          debit: 0,
          credit: invoice.total_amount,
          description: `ذمم موردين - ${invoice.invoice_number}`
        })

      console.log('✅ GL Entry created:', entryNumber)
    } catch (error) {
      console.error('Error creating GL entry:', error)
      // Don't throw - invoice is already created
    }
  }

  const resetForm = () => {
    setCreateMode('with-po')
    setSelectedVendorId('')
    setSelectedPOId('')
    setSelectedPO(null)
    setInvoiceLines([])
    setInvoiceDate(new Date())
    setInvoiceNumber('')
    setDueDate(undefined)
    setNotes('')
    setAvailableProducts([])
  }

  const selectedCount = invoiceLines.filter(line => line.selected).length
  
  // Calculate detailed totals
  const selectedLines = invoiceLines.filter(line => line.selected)
  const subtotal = selectedLines.reduce((sum, line) => 
    sum + (line.quantity_to_invoice * line.unit_price), 0)
  const totalDiscount = selectedLines.reduce((sum, line) => 
    sum + (line.discount_amount || 0), 0)
  const totalTax = selectedLines.reduce((sum, line) => {
    const afterDiscount = (line.quantity_to_invoice * line.unit_price) - (line.discount_amount || 0)
    return sum + (afterDiscount * (line.tax_rate / 100))
  }, 0)
  const totalToInvoice = subtotal - totalDiscount + totalTax

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-2xl">إضافة فاتورة مشتريات جديدة</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Creation Mode Selection */}
          <div className="flex gap-2 bg-muted/30 dark:bg-muted/10 p-2 rounded-lg">
            <Button
              type="button"
              variant={createMode === 'with-po' ? 'default' : 'outline'}
              onClick={() => {
                setCreateMode('with-po')
                setInvoiceLines([])
                // If vendor already selected, load POs
                if (selectedVendorId) {
                  loadPurchaseOrders(selectedVendorId)
                }
              }}
              className="flex-1"
            >
              إنشاء من أمر شراء
            </Button>
            <Button
              type="button"
              variant={createMode === 'without-po' ? 'default' : 'outline'}
              onClick={() => {
                setCreateMode('without-po')
                setSelectedPOId('')
                setSelectedPO(null)
                setInvoiceLines([])
                if (!invoiceNumber) {
                  setInvoiceNumber(`PINV-${Date.now()}`)
                }
                loadProducts()
              }}
              className="flex-1"
            >
              إنشاء فاتورة مباشرة
            </Button>
          </div>

          {/* Vendor and PO Selection */}
          <div className={`grid ${(createMode === 'with-po' && selectedVendorId) ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            <div className="space-y-2">
              <Label>اختر المورد *</Label>
              <Select 
                value={selectedVendorId} 
                onValueChange={(value) => {
                  console.log('🏢 Vendor changed to:', value)
                  setSelectedVendorId(value)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingVendors ? 'جاري التحميل...' : 'اختر مورد'} />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map(vendor => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.code} - {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* PO Selection - Only show in with-po mode */}
            {createMode === 'with-po' && selectedVendorId ? (
              <div className="space-y-2">
                <Label>اختر أمر الشراء *</Label>
                <Select value={selectedPOId} onValueChange={setSelectedPOId} disabled={loadingPOs}>
                  <SelectTrigger>
                    <SelectValue placeholder={
                      loadingPOs 
                        ? 'جاري التحميل...' 
                        : availablePOs.length === 0 
                          ? 'لا توجد أوامر شراء متاحة' 
                          : 'اختر أمر شراء'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePOs.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <p className="font-semibold mb-2">لا توجد أوامر شراء متاحة</p>
                        <p className="text-xs">قد يكون السبب:</p>
                        <ul className="text-xs mt-1 space-y-1">
                          <li>• لا توجد أوامر شراء لهذا المورد</li>
                          <li>• جميع الأوامر تم فوترتها بالكامل</li>
                        </ul>
                      </div>
                    ) : (
                      availablePOs.map(po => (
                        <SelectItem key={po.id} value={po.id}>
                          {toEnglishDigits(po.order_number)} - {toEnglishDigits(po.total_amount.toFixed(2))} ريال ({po.status})
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
                {!loadingPOs && availablePOs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    تم العثور على {toEnglishDigits(availablePOs.length)} {availablePOs.length === 1 ? 'أمر شراء' : 'أوامر شراء'}
                  </p>
                )}
              </div>
            ) : createMode === 'with-po' && !selectedVendorId && (
              <div className="space-y-2 flex items-end">
                <p className="text-sm text-muted-foreground pb-2">
                  ← اختر المورد أولاً لعرض أوامر الشراء
                </p>
              </div>
            )}
          </div>

          {/* PO Details */}
          {selectedPO && (
            <div className="bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="text-muted-foreground">رقم أمر الشراء</p>
                    <p className="font-semibold text-foreground">{selectedPO.order_number}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="text-muted-foreground">المورد</p>
                    <p className="font-semibold text-foreground">{selectedPO.vendor?.name || 'غير محدد'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="text-muted-foreground">تاريخ الأمر</p>
                    <p className="font-semibold text-foreground font-mono">
                      {format(new Date(selectedPO.order_date), 'dd/MM/yyyy')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="text-muted-foreground">إجمالي الأمر</p>
                    <p className="font-semibold text-foreground font-mono">{toEnglishDigits(selectedPO.total_amount.toFixed(2))} ريال</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Invoice Details */}
          <div className="bg-muted/30 dark:bg-muted/10 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-sm text-foreground">تفاصيل الفاتورة</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>رقم الفاتورة *</Label>
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="PINV-001"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>تاريخ الفاتورة *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
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
                <Label>تاريخ الاستحقاق</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
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
            </div>
          </div>

          {/* Add Products Directly (without PO mode) */}
          {createMode === 'without-po' && selectedVendorId && (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-muted/30 dark:bg-muted/10 rounded-lg p-3">
                <Label className="text-base font-semibold">إضافة منتجات</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newLine: InvoiceLine = {
                      po_line_id: `temp-${Date.now()}`,
                      product_id: '',
                      product_name: '',
                      product_code: '',
                      ordered_quantity: 0,
                      already_invoiced: 0,
                      remaining_quantity: 999999,
                      quantity_to_invoice: 1,
                      unit_price: 0,
                      discount_amount: 0,
                      tax_rate: 15,
                      selected: true
                    }
                    setInvoiceLines([...invoiceLines, newLine])
                  }}
                >
                  + إضافة منتج
                </Button>
              </div>

              {invoiceLines.length > 0 && (
                <div className="border rounded-lg overflow-hidden shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/70 dark:bg-muted">
                      <tr className="border-b-2">
                        <th className="p-3 text-right font-semibold">المنتج</th>
                        <th className="p-3 text-center font-semibold">الكمية</th>
                        <th className="p-3 text-center font-semibold">سعر الوحدة</th>
                        <th className="p-3 text-center font-semibold">خصم</th>
                        <th className="p-3 text-center font-semibold">الإجمالي</th>
                        <th className="p-3 text-center font-semibold w-12">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {invoiceLines.map((line, index) => (
                        <tr key={line.po_line_id} className="hover:bg-accent/50">
                          <td className="p-3">
                            <Select
                              value={line.product_id}
                              onValueChange={(value) => {
                                const product = availableProducts.find(p => p.id === value)
                                if (product) {
                                  setInvoiceLines(lines =>
                                    lines.map((l, i) =>
                                      i === index
                                        ? {
                                            ...l,
                                            product_id: product.id,
                                            product_name: product.name,
                                            product_code: product.code,
                                            unit_price: product.cost_price || 0
                                          }
                                        : l
                                    )
                                  )
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="اختر منتج" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableProducts.map(product => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.code} - {product.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-3">
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={line.quantity_to_invoice}
                              onChange={(e) => handleQuantityChange(index, e.target.value)}
                              className="w-24 text-center font-mono"
                            />
                          </td>
                          <td className="p-3">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unit_price}
                              onChange={(e) => {
                                setInvoiceLines(lines =>
                                  lines.map((l, i) =>
                                    i === index ? { ...l, unit_price: parseFloat(e.target.value) || 0 } : l
                                  )
                                )
                              }}
                              className="w-28 text-center font-mono"
                            />
                          </td>
                          <td className="p-3">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.discount_amount}
                              onChange={(e) => {
                                setInvoiceLines(lines =>
                                  lines.map((l, i) =>
                                    i === index ? { ...l, discount_amount: parseFloat(e.target.value) || 0 } : l
                                  )
                                )
                              }}
                              className="w-24 text-center font-mono"
                            />
                          </td>
                          <td className="p-3 text-center font-bold text-foreground font-mono">
                            {toEnglishDigits(calculateLineTotal(line).toFixed(2))} ر.س
                          </td>
                          <td className="p-3 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setInvoiceLines(lines => lines.filter((_, i) => i !== index))
                              }}
                            >
                              ✕
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Invoice Lines (from PO) */}
          {createMode === 'with-po' && invoiceLines.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-muted/30 dark:bg-muted/10 rounded-lg p-3">
                <Label className="text-base font-semibold">بنود الفاتورة ({invoiceLines.length})</Label>
                <div className="flex items-center gap-2 bg-background px-3 py-1.5 rounded-md border">
                  <Checkbox
                    id="select-all"
                    checked={invoiceLines.every(line => line.selected || line.remaining_quantity === 0)}
                    onCheckedChange={handleSelectAll}
                  />
                  <label htmlFor="select-all" className="text-sm cursor-pointer font-medium">
                    تحديد الكل
                  </label>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-muted/70 dark:bg-muted">
                    <tr className="border-b-2">
                      <th className="p-3 text-right w-12 font-semibold">✓</th>
                      <th className="p-3 text-right font-semibold">المنتج</th>
                      <th className="p-3 text-center font-semibold">الكمية المطلوبة</th>
                      <th className="p-3 text-center font-semibold">تم الفوترة</th>
                      <th className="p-3 text-center font-semibold">المتبقي</th>
                      <th className="p-3 text-center font-semibold">كمية الفاتورة</th>
                      <th className="p-3 text-center font-semibold">سعر الوحدة</th>
                      <th className="p-3 text-center font-semibold">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoiceLines.map((line, index) => {
                      const canInvoice = line.remaining_quantity > 0

                      return (
                        <tr
                          key={line.po_line_id}
                          className={!canInvoice ? 'bg-muted/30' : 'hover:bg-accent/50'}
                        >
                          <td className="p-3 text-center">
                            <Checkbox
                              checked={line.selected}
                              onCheckedChange={(checked) => handleLineSelect(index, checked as boolean)}
                              disabled={!canInvoice}
                            />
                          </td>
                          <td className="p-3">
                            <div>
                              <p className="font-medium text-foreground">{line.product_name}</p>
                              <p className="text-xs text-muted-foreground">{line.product_code}</p>
                            </div>
                          </td>
                          <td className="p-3 text-center font-medium font-mono">
                            {toEnglishDigits(line.ordered_quantity)}
                          </td>
                          <td className="p-3 text-center text-green-600 dark:text-green-400 font-medium font-mono">
                            {toEnglishDigits(line.already_invoiced)}
                          </td>
                          <td className="p-3 text-center">
                            <Badge variant={line.remaining_quantity > 0 ? 'default' : 'secondary'}>
                              {toEnglishDigits(line.remaining_quantity)}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Input
                              type="number"
                              min="0"
                              max={line.remaining_quantity}
                              step="0.01"
                              value={line.quantity_to_invoice}
                              onChange={(e) => handleQuantityChange(index, e.target.value)}
                              disabled={!line.selected}
                              className="w-24 text-center font-mono"
                            />
                          </td>
                          <td className="p-3 text-center text-muted-foreground font-mono">
                            {toEnglishDigits(line.unit_price.toFixed(2))} ر.س
                          </td>
                          <td className="p-3 text-center font-bold text-foreground font-mono">
                            {toEnglishDigits(calculateLineTotal(line).toFixed(2))} ر.س
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              {selectedCount > 0 && (
                <div className="bg-gradient-to-br from-primary/10 to-primary/5 dark:from-primary/20 dark:to-primary/10 border border-primary/30 rounded-lg p-5 shadow-sm">
                  <h4 className="font-semibold mb-3 text-foreground">ملخص الفاتورة</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">عدد البنود:</span>
                      <span className="font-semibold text-foreground">{toEnglishDigits(selectedCount)} بند</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">المجموع الفرعي:</span>
                      <span className="font-mono font-medium text-foreground">{toEnglishDigits(subtotal.toFixed(2))} ر.س</span>
                    </div>
                    {totalDiscount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">الخصم:</span>
                        <span className="font-mono font-medium text-red-600 dark:text-red-400">- {toEnglishDigits(totalDiscount.toFixed(2))} ر.س</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">ضريبة القيمة المضافة (15%):</span>
                      <span className="font-mono font-medium text-foreground">{toEnglishDigits(totalTax.toFixed(2))} ر.س</span>
                    </div>
                    <div className="border-t pt-2 mt-2">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-foreground">الإجمالي النهائي:</span>
                        <span className="text-2xl font-bold text-primary dark:text-primary-foreground font-mono">
                          {toEnglishDigits(totalToInvoice.toFixed(2))} ر.س
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Summary for without-po mode */}
          {createMode === 'without-po' && invoiceLines.length > 0 && (
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 dark:from-primary/20 dark:to-primary/10 border border-primary/30 rounded-lg p-5 shadow-sm">
              <h4 className="font-semibold mb-3 text-foreground">ملخص الفاتورة</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">عدد البنود:</span>
                  <span className="font-semibold text-foreground">{toEnglishDigits(selectedCount)} بند</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">المجموع الفرعي:</span>
                  <span className="font-mono font-medium text-foreground">{toEnglishDigits(subtotal.toFixed(2))} ر.س</span>
                </div>
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">الخصم:</span>
                    <span className="font-mono font-medium text-red-600 dark:text-red-400">- {toEnglishDigits(totalDiscount.toFixed(2))} ر.س</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">ضريبة القيمة المضافة (15%):</span>
                  <span className="font-mono font-medium text-foreground">{toEnglishDigits(totalTax.toFixed(2))} ر.س</span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-foreground">الإجمالي النهائي:</span>
                    <span className="text-2xl font-bold text-primary dark:text-primary-foreground font-mono">
                      {toEnglishDigits(totalToInvoice.toFixed(2))} ر.س
                    </span>
                  </div>
                </div>
              </div>
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
          <div className="flex gap-3 pt-4 border-t">
            <Button
              onClick={handleSubmit}
              disabled={loading || invoiceLines.length === 0 || !invoiceNumber.trim() || !selectedVendorId}
              className="flex-1 h-11"
              size="lg"
            >
              {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              {!loading && <DollarSign className="ml-2 h-4 w-4" />}
              إنشاء فاتورة المشتريات
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="h-11"
              size="lg"
            >
              إلغاء
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
