import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
import { Plus, Trash2, CalendarIcon, X, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { vendorsService } from '@/services/supabase-service'
import { supabase, resolveOrgIdWithFallback } from '@/lib/supabase'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { loadRawMaterials, loadPurchasableProducts } from '@/lib/product-utils'
import { useKeyboardNav } from '@/utils/keyboardNav'
import { parseClipboardTable } from '@/utils/parseClipboard'

interface Product {
  id: string
  code: string
  name?: string | null
  name_ar?: string | null
  name_en?: string | null
  cost_price?: number | null
}

const getProductDisplayName = (product: Product) => {
  if (product.name_ar?.trim()) return product.name_ar.trim()
  if (product.name?.trim()) return product.name.trim()
  if (product.name_en?.trim()) return product.name_en.trim()
  return product.code
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
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess?: () => void
}

const recalcLineTotals = (line: PurchaseOrderLine): PurchaseOrderLine => {
  const quantity = Number.isFinite(line.quantity) ? line.quantity : 0
  const price = Number.isFinite(line.unit_price) ? line.unit_price : 0
  const discountPct = Number.isFinite(line.discount_percentage) ? line.discount_percentage : 0
  const taxPct = Number.isFinite(line.tax_percentage) ? line.tax_percentage : 0

  const subtotal = quantity * price
  const discount = subtotal * (discountPct / 100)
  const afterDiscount = subtotal - discount
  const tax = afterDiscount * (taxPct / 100)

  return {
    ...line,
    line_total: afterDiscount + tax,
  }
}

const createEmptyLine = (): PurchaseOrderLine =>
  recalcLineTotals({
    product_id: '',
    product_code: '',
    product_name: '',
    quantity: 1,
    unit_price: 0,
    discount_percentage: 0,
    tax_percentage: 15,
    line_total: 0,
  })

const calculateTotals = (lines: PurchaseOrderLine[]) => {
  const subtotal = lines.reduce((sum, line) => {
    const base = line.quantity * line.unit_price
    const discount = base * (line.discount_percentage / 100)
    return sum + (base - discount)
  }, 0)

  const discountAmount = lines.reduce((sum, line) => {
    const base = line.quantity * line.unit_price
    return sum + base * (line.discount_percentage / 100)
  }, 0)

  const taxAmount = lines.reduce((sum, line) => {
    const base = line.quantity * line.unit_price
    const discount = base * (line.discount_percentage / 100)
    const net = base - discount
    return sum + net * (line.tax_percentage / 100)
  }, 0)

  return {
    subtotal,
    discountAmount,
    taxAmount,
    total: subtotal + taxAmount,
  }
}

  interface InlineProductSearchProps {
    readonly products: ReadonlyArray<Product>
    readonly term: string
    readonly selectedProduct?: Product
    readonly onTermChange: (term: string) => void
    readonly onSelect: (product: Product) => void
    readonly onClear: () => void
  }

  function InlineProductSearch({
    products,
    term,
    selectedProduct,
    onTermChange,
    onSelect,
    onClear,
  }: InlineProductSearchProps) {
    const [open, setOpen] = useState(false)
    const [highlighted, setHighlighted] = useState(0)
    const [searchTerm, setSearchTerm] = useState(term)
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
    const containerRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)

    // Sync searchTerm with term prop when product is selected
    useEffect(() => {
      if (selectedProduct) {
        setSearchTerm(term)
      }
    }, [term, selectedProduct])

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (!containerRef.current) return
        if (containerRef.current.contains(event.target as Node)) return
        setOpen(false)
      }

      if (open && products.length > 0) {
        console.log('🔓 Dropdown opened with', products.length, 'products available')
      }

      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [open, products.length])

    const filtered = useMemo(() => {
      const trimmed = searchTerm.trim()
      if (!trimmed) {
        console.log('🔍 No search term, showing first 20 products of', products.length)
        return products.slice(0, 20)
      }

      const tokens = trimmed
        .toLowerCase()
        .replaceAll('-', ' ')
        .replaceAll('–', ' ')
        .replaceAll('—', ' ')
        .split(/\s+/)
        .filter((token) => token && token !== '-')

      if (tokens.length === 0) {
        return products.slice(0, 20)
      }

      console.log('🔍 Search tokens:', tokens, 'from', products.length, 'products')

      const results = products
        .filter((product) => {
          const normalizedFields = [
            product.code,
            product.name,
            product.name_ar,
            product.name_en,
          ]
            .map((value) => (typeof value === 'string' ? value : ''))
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0)

          if (normalizedFields.length === 0) {
            return false
          }

          const matches = tokens.every((token) =>
            normalizedFields.some((field) => field.includes(token)),
          )

          return matches
        })
        .slice(0, 20)

      console.log('✅ Found', results.length, 'matching products')
      if (results.length > 0) {
        console.log('📦 First result:', results[0])
      }

      return results
    }, [products, searchTerm])

    useEffect(() => {
      if (!open) {
        setHighlighted(0)
      } else if (highlighted >= filtered.length) {
        setHighlighted(filtered.length - 1)
      }
    }, [open, highlighted, filtered.length])

    // Update dropdown position on scroll
    useEffect(() => {
      if (!open || !inputRef.current) return

      const updatePosition = () => {
        if (inputRef.current) {
          const rect = inputRef.current.getBoundingClientRect()
          setDropdownPosition({
            top: rect.bottom,
            left: rect.left,
            width: rect.width
          })
        }
      }

      // Initial position
      updatePosition()

      // Update on scroll or resize
      globalThis.addEventListener('scroll', updatePosition, true)
      globalThis.addEventListener('resize', updatePosition)

      return () => {
        globalThis.removeEventListener('scroll', updatePosition, true)
        globalThis.removeEventListener('resize', updatePosition)
      }
    }, [open])

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        setOpen(true)
      }

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault()
          event.stopPropagation()
          setHighlighted((prev) => Math.min(prev + 1, Math.max(filtered.length - 1, 0)))
          break
        }
        case 'ArrowUp': {
          event.preventDefault()
          event.stopPropagation()
          setHighlighted((prev) => Math.max(prev - 1, 0))
          break
        }
        case 'Enter': {
          if (open && filtered[highlighted]) {
            event.preventDefault()
            onSelect(filtered[highlighted])
            setOpen(false)
          }
          break
        }
        case 'Escape': {
          setOpen(false)
          break
        }
        default:
          break
      }
    }

    return (
      <div ref={containerRef} className="relative">
        <div className="relative flex items-center gap-2">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            data-disable-nav="true"
            value={selectedProduct ? term : searchTerm}
            placeholder="ابحث بالكود أو الاسم..."
            onChange={(event) => {
              const newValue = event.target.value
              setSearchTerm(newValue)
              onTermChange(newValue)
              setOpen(true)
              
              // Update position when typing
              if (inputRef.current) {
                const rect = inputRef.current.getBoundingClientRect()
                setDropdownPosition({
                  top: rect.bottom,
                  left: rect.left,
                  width: rect.width
                })
              }
            }}
            onFocus={() => {
              setOpen(true)
              // Update position on focus
              if (inputRef.current) {
                const rect = inputRef.current.getBoundingClientRect()
                setDropdownPosition({
                  top: rect.bottom,
                  left: rect.left,
                  width: rect.width
                })
              }
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              'h-9 pr-9',
              selectedProduct && 'border-green-500 bg-green-50 dark:bg-green-950',
            )}
          />
          {(searchTerm || term) && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-9 px-2">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {open && filtered.length > 0 && createPortal(
          <div
            role="listbox"
            aria-label="Product search results"
            tabIndex={0}
            style={{
              position: 'fixed',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
              zIndex: 9999,
            }}
            className="mt-1 bg-popover border rounded-md shadow-lg max-h-72 overflow-auto"
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="sticky top-0 px-3 py-2 bg-muted/80 backdrop-blur-sm text-xs font-semibold border-b flex items-center justify-between">
              <span>{filtered.length} نتيجة</span>
              <span className="text-muted-foreground">↑↓ للتنقل • Enter للاختيار</span>
            </div>
            {filtered.map((product, index) => {
              const isActive = index === highlighted
              return (
                <button
                  key={product.id}
                  type="button"
                  className={cn(
                    'w-full px-3 py-2.5 text-left border-b last:border-b-0 transition-colors',
                    isActive ? 'bg-primary/10' : 'hover:bg-muted/50',
                  )}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => {
                    setTimeout(() => {
                      onSelect(product)
                      setOpen(false)
                    }, 0)
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono text-primary font-semibold">{product.code}</div>
                      <div className="text-sm font-medium truncate">{getProductDisplayName(product)}</div>
                    </div>
                    <div className="text-xs font-semibold text-green-600 whitespace-nowrap">
                      {(product.cost_price ?? 0).toFixed(2)} ر.س
                    </div>
                  </div>
                </button>
              )
            })}
          </div>,
          document.body
        )}

        {open && filtered.length === 0 && term && createPortal(
          <output
            aria-live="polite"
            style={{
              position: 'fixed',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
              zIndex: 9999,
            }}
            className="mt-1 bg-popover border rounded-md shadow-lg p-4 text-center text-sm text-muted-foreground block"
          >
            لا توجد نتائج للبحث: "{term}"
          </output>,
          document.body
        )}
      </div>
    )
  }

  export function PurchaseOrderForm({ open, onOpenChange, onSuccess }: PurchaseOrderFormProps) {
    const [loading, setLoading] = useState(false)
    const [vendors, setVendors] = useState<any[]>([])
    const [products, setProducts] = useState<Product[]>([])
    const [selectedVendor, setSelectedVendor] = useState('')
    const [orderDate, setOrderDate] = useState<Date>(new Date())
    const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<Date | undefined>(undefined)
    const [notes, setNotes] = useState('')
    const [lines, setLines] = useState<PurchaseOrderLine[]>([createEmptyLine()])
    const tableRef = useRef<HTMLTableElement | null>(null)

    useKeyboardNav(tableRef)

    useEffect(() => {
      if (open) {
        void loadVendors()
        void loadProducts()
      }
    }, [open])

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
        let items: Product[] = []

        try {
          const rawMaterials = await loadRawMaterials()
          if (rawMaterials.length > 0) {
            console.log('✅ Loaded', rawMaterials.length, 'raw materials')
            console.log('📦 Sample product:', rawMaterials[0])
            items = rawMaterials
          }
        } catch (rawError) {
          console.warn('⚠️ Raw materials not available, falling back to purchasable list', rawError)
        }

        if (items.length === 0) {
          const purchasable = await loadPurchasableProducts()
          console.log('✅ Loaded', purchasable.length, 'purchasable products')
          if (purchasable.length > 0) {
            console.log('📦 Sample product:', purchasable[0])
          }
          items = purchasable
        }

        if (items.length === 0) {
          toast.error('لم يتم العثور على منتجات للشراء')
        } else {
          console.log('📊 Total products loaded:', items.length)
        }

        setProducts(items)
      } catch (error) {
        console.error('Error loading products:', error)
        toast.error('خطأ في تحميل المنتجات')
      }
    }

    const totals = useMemo(() => calculateTotals(lines), [lines])

    const addLine = useCallback(() => {
      setLines((prev) => [...prev, createEmptyLine()])
    }, [])

    const removeLine = useCallback((index: number) => {
      setLines((prev) => {
        if (prev.length <= 1) return prev
        return prev.filter((_, i) => i !== index)
      })
    }, [])

    const updateLine = useCallback((index: number, partial: Partial<PurchaseOrderLine>) => {
      setLines((prev) => {
        const next = [...prev]
        const updated = recalcLineTotals({ ...next[index], ...partial })
        next[index] = updated
        return next
      })
    }, [])

    const handleProductSelect = useCallback(
      (index: number, product: Product) => {
        const displayName = getProductDisplayName(product)
        updateLine(index, {
          product_id: product.id,
          product_code: product.code,
          product_name: displayName,
          unit_price: product.cost_price || 0,
        })
      },
      [updateLine],
    )

    const handleProductTermChange = useCallback((index: number, term: string) => {
      setLines((prev) => {
        const next = [...prev]
        const current = next[index]
        const trimmed = term.trim()
        
        // إذا كان الحقل فارغاً، امسح كل شيء
        if (trimmed.length === 0) {
          const updated = recalcLineTotals({
            ...current,
            product_code: '',
            product_name: '',
            product_id: '',
            unit_price: 0,
          })
          next[index] = updated
          return next
        }
        
        // إذا كان هناك منتج مختار بالفعل، لا تمسح بياناته (دع المستخدم يبحث)
        // فقط حدث product_code للبحث
        const updated = recalcLineTotals({
          ...current,
          product_code: term,
          // احتفظ بـ product_name و product_id الحالية حتى يختار منتج جديد
        })
        next[index] = updated
        return next
      })
    }, [])

    const handleClearProduct = useCallback((index: number) => {
      updateLine(index, {
        product_id: '',
        product_code: '',
        product_name: '',
        unit_price: 0,
      })
    }, [updateLine])

    const handlePaste = useCallback(async () => {
      try {
        const rows = await parseClipboardTable()
        if (!rows.length) {
          toast.error('لم يتم العثور على بيانات قابلة للقراءة من الحافظة')
          return
        }

        const byCode = new Map<string, Product>()
        const byName = new Map<string, Product>()

        products.forEach((product) => {
          if (product.code) {
            byCode.set(product.code.toLowerCase(), product)
          }

          const candidateNames = [product.name, product.name_ar, product.name_en]
          candidateNames
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .forEach((value) => {
              byName.set(value.toLowerCase(), product)
            })
        })

        const aggregated = new Map<string, PurchaseOrderLine>()

        rows.forEach((cells, rowIndex) => {
          const [codeRaw = '', qtyRaw = '1', priceRaw] = cells
          const code = codeRaw.trim()
          const quantity = Number.parseFloat(qtyRaw.replace(',', '.')) || 1
          const priceCandidate = priceRaw ? Number.parseFloat(priceRaw.replace(',', '.')) : undefined
          const lookupKey = code.toLowerCase()
          const product = byCode.get(lookupKey) || byName.get(lookupKey)
          const aggregationKey = (product?.code || code || `row-${rowIndex}`).toLowerCase()

          const existing = aggregated.get(aggregationKey)
          if (existing) {
            existing.quantity += quantity
            if (priceCandidate !== undefined && !Number.isNaN(priceCandidate)) {
              existing.unit_price = priceCandidate
            }
          } else {
            aggregated.set(
              aggregationKey,
              {
                product_id: product?.id || '',
                product_code: product?.code || code,
                product_name: product?.name || code || `صنف ${rowIndex + 1}`,
                quantity,
                unit_price: priceCandidate ?? product?.cost_price ?? 0,
                discount_percentage: 0,
                tax_percentage: 15,
                line_total: 0,
              },
            )
          }
        })

        const newLines = Array.from(aggregated.values()).map((line) => recalcLineTotals(line))
        setLines((prev) => [...prev, ...newLines])
        toast.success(`تم لصق ${newLines.length} أصناف`)
      } catch (error) {
        console.error('Error parsing clipboard', error)
        toast.error('تعذر قراءة بيانات الحافظة')
      }
    }, [products])

    useEffect(() => {
      const handleShortcut = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey)) return
        if (event.key.toLowerCase() !== 'v') return
        if (!tableRef.current) return
        if (!document.activeElement) return
        if (!tableRef.current.contains(document.activeElement)) return

        event.preventDefault()
        void handlePaste()
      }

      globalThis.addEventListener('keydown', handleShortcut)
      return () => globalThis.removeEventListener('keydown', handleShortcut)
    }, [handlePaste])

    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault()

      if (!selectedVendor) {
        toast.error('الرجاء اختيار المورد')
        return
      }

      const validLines = lines.filter((line) => line.product_id)
      if (validLines.length === 0) {
        toast.error('الرجاء إضافة منتج واحد على الأقل')
        return
      }

      setLoading(true)

      try {
        const orgId = await resolveOrgIdWithFallback()
        const orderNumber = `PO-${Date.now()}`

        const { subtotal, discountAmount, taxAmount, total } = calculateTotals(validLines)

        const { data: order, error: orderError } = await supabase
          .from('purchase_orders')
          .insert({
            org_id: orgId,
            order_number: orderNumber,
            vendor_id: selectedVendor,
            order_date: format(orderDate, 'yyyy-MM-dd'),
            expected_delivery_date: expectedDeliveryDate ? format(expectedDeliveryDate, 'yyyy-MM-dd') : null,
            status: 'draft',
            subtotal,
            discount_amount: discountAmount,
            tax_amount: taxAmount,
            total_amount: total,
            notes: notes || null,
          })
          .select()
          .single()

        if (orderError) throw orderError

        const orderLines = validLines.map((line, index) => ({
          org_id: orgId,
          purchase_order_id: order.id,
          line_number: index + 1,
          product_id: line.product_id,
          description: line.description || null,
          quantity: line.quantity,
          unit_price: line.unit_price,
          discount_percentage: line.discount_percentage,
          tax_percentage: line.tax_percentage,
        }))

        const { error: linesError } = await supabase.from('purchase_order_lines').insert(orderLines)
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

    const resetForm = useCallback(() => {
      setSelectedVendor('')
      setOrderDate(new Date())
      setExpectedDeliveryDate(undefined)
      setNotes('')
      setLines([createEmptyLine()])
    }, [])

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
            <div className="flex flex-wrap justify-between items-center gap-2">
              <h3 className="text-lg font-semibold">المنتجات</h3>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={addLine}
                  size="sm"
                  variant="outline"
                  data-add-line
                >
                <Plus className="h-4 w-4 ml-2" />
                إضافة سطر
              </Button>
                <Button type="button" onClick={handlePaste} size="sm" variant="outline">
                  <Upload className="h-4 w-4 ml-2" />
                  لصق من Excel
                </Button>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table ref={tableRef} className="w-full table-fixed">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-right p-2 text-sm font-medium w-[35%]">المنتج</th>
                      <th className="text-right p-2 text-sm font-medium w-[12%]">الكمية</th>
                      <th className="text-right p-2 text-sm font-medium w-[13%]">السعر</th>
                      <th className="text-right p-2 text-sm font-medium w-[10%]">خصم %</th>
                      <th className="text-right p-2 text-sm font-medium w-[10%]">ضريبة %</th>
                      <th className="text-right p-2 text-sm font-medium w-[13%]">الإجمالي</th>
                      <th className="text-center p-2 w-[7%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => {
                      const selectedProduct = line.product_id
                        ? products.find((product) => product.id === line.product_id)
                        : undefined
                      
                      // إذا كان هناك منتج مختار، اعرض الكود + الاسم
                      // إذا لم يكن هناك منتج مختار، اعرض فقط ما يكتبه المستخدم
                      const displayTerm = line.product_id && selectedProduct
                        ? `${selectedProduct.code} - ${getProductDisplayName(selectedProduct)}`
                        : line.product_code || ''

                      const lineNumber = (line as { line_number?: number }).line_number;
                      const lineKey = line.id || `${line.product_id}-${lineNumber || Date.now()}`
                      return (
                        <tr key={lineKey} className="border-t hover:bg-muted/50">
                          <td className="p-2">
                            <InlineProductSearch
                              products={products}
                              term={displayTerm}
                              selectedProduct={selectedProduct}
                              onTermChange={(term) => handleProductTermChange(index, term)}
                              onSelect={(product) => handleProductSelect(index, product)}
                              onClear={() => handleClearProduct(index)}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min="1"
                              step="0.01"
                              value={line.quantity}
                              onChange={(event) =>
                                updateLine(index, {
                                  quantity: Number.parseFloat(event.target.value) || 0,
                                })
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.unit_price}
                              onChange={(event) =>
                                updateLine(index, {
                                  unit_price: Number.parseFloat(event.target.value) || 0,
                                })
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={line.discount_percentage}
                              onChange={(event) =>
                                updateLine(index, {
                                  discount_percentage: Number.parseFloat(event.target.value) || 0,
                                })
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={line.tax_percentage}
                              onChange={(event) =>
                                updateLine(index, {
                                  tax_percentage: Number.parseFloat(event.target.value) || 0,
                                })
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="p-2">
                            <div className="text-right font-semibold text-sm">
                              {line.line_total.toFixed(2)}
                            </div>
                          </td>
                          <td className="p-2 text-center">
                            {lines.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeLine(index)}
                                className="h-9 w-9 p-0"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals Summary */}
            <div className="flex justify-end">
              <div className="w-80 space-y-2 border rounded-lg p-4 bg-muted/30">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">الإجمالي الفرعي:</span>
                  <span className="font-semibold">{totals.subtotal.toFixed(2)} ر.س</span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>الخصم:</span>
                    <span className="font-semibold">-{totals.discountAmount.toFixed(2)} ر.س</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">الضريبة:</span>
                  <span className="font-semibold">{totals.taxAmount.toFixed(2)} ر.س</span>
                </div>
                <div className="flex justify-between text-base font-bold border-t pt-2 mt-2">
                  <span>الإجمالي:</span>
                  <span className="text-primary">{totals.total.toFixed(2)} ر.س</span>
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
            <Button type="submit" disabled={loading || lines.every((line) => !line.product_id)}>
              {loading ? 'جاري الحفظ...' : 'حفظ أمر الشراء'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}