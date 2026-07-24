import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { UomQuantityInput, type UomQuantityValue } from '@/components/uom/UomQuantityInput'
import { Button } from '@/components/ui/button'
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
import { useAuth } from '@/contexts/AuthContext'
import {
  createAtomicUomPurchaseOrder,
  mapPurchaseOrderError,
} from '@/features/purchasing/purchase-order-service'
import {
  buildPurchaseOrderUomLinePayload,
  calculateCommercialLineTotal,
} from '@/features/purchasing/purchase-order-uom'
import { useUomEngineEnabled } from '@/hooks/use-uom-engine-enabled'
import { supabase } from '@/lib/supabase'

interface PurchaseOrderFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess?: () => void
}

interface VendorOption {
  id: string
  code: string | null
  name: string
}

interface ProductOption {
  id: string
  code: string
  name: string | null
  name_ar: string | null
  cost_price: number | null
  uom_migration_status: string
}

interface PurchaseLine {
  key: string
  productId: string
  description: string
  quantity: UomQuantityValue
  unitPriceEntered: number
  discountPercentage: number
  taxPercentage: number
}

const emptyQuantity = (): UomQuantityValue => ({
  quantityEntered: 1,
  uomId: '',
  factorToBase: 1,
  baseQuantity: 1,
})

const emptyLine = (): PurchaseLine => ({
  key: crypto.randomUUID(),
  productId: '',
  description: '',
  quantity: emptyQuantity(),
  unitPriceEntered: 0,
  discountPercentage: 0,
  taxPercentage: 15,
})

function productLabel(product: ProductOption) {
  return `${product.code} - ${product.name_ar?.trim() || product.name?.trim() || product.code}`
}

export function PurchaseOrderForm({ open, onOpenChange, onSuccess }: PurchaseOrderFormProps) {
  const { currentOrgId } = useAuth()
  const { isEnabled: uomEnabled, isLoading: flagLoading } = useUomEngineEnabled()
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [vendorId, setVendorId] = useState('')
  const [orderDate, setOrderDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PurchaseLine[]>([emptyLine()])

  useEffect(() => {
    if (!open || !currentOrgId || !uomEnabled) return
    let cancelled = false

    const load = async () => {
      const [vendorResult, productResult] = await Promise.all([
        supabase
          .from('vendors')
          .select('id,code,name')
          .eq('org_id', currentOrgId)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('products')
          .select('id,code,name,name_ar,cost_price,uom_migration_status')
          .eq('org_id', currentOrgId)
          .eq('is_active', true)
          .eq('uom_migration_status', 'MAPPED')
          .order('code'),
      ])

      if (vendorResult.error) throw vendorResult.error
      if (productResult.error) throw productResult.error
      if (cancelled) return
      setVendors((vendorResult.data ?? []) as VendorOption[])
      setProducts((productResult.data ?? []) as ProductOption[])
    }

    void load().catch((error) => {
      console.error('Failed to load purchase order form data', error)
      toast.error('تعذر تحميل بيانات أمر الشراء')
    })

    return () => {
      cancelled = true
    }
  }, [currentOrgId, open, uomEnabled])

  const totals = useMemo(() => {
    const gross = lines.reduce(
      (sum, line) => sum + line.quantity.quantityEntered * line.unitPriceEntered,
      0,
    )
    const discount = lines.reduce(
      (sum, line) => sum
        + line.quantity.quantityEntered
          * line.unitPriceEntered
          * (line.discountPercentage / 100),
      0,
    )
    const total = lines.reduce(
      (sum, line) => sum + calculateCommercialLineTotal({
        quantityEntered: line.quantity.quantityEntered,
        unitPriceEntered: line.unitPriceEntered,
        discountPercentage: line.discountPercentage,
        taxPercentage: line.taxPercentage,
      }),
      0,
    )
    const subtotal = gross - discount
    return { subtotal, discount, tax: total - subtotal, total }
  }, [lines])

  const updateLine = (key: string, patch: Partial<PurchaseLine>) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))
  }

  const selectProduct = (line: PurchaseLine, productId: string) => {
    const product = products.find((candidate) => candidate.id === productId)
    updateLine(line.key, {
      productId,
      description: product ? productLabel(product) : '',
      unitPriceEntered: product?.cost_price ?? 0,
      quantity: emptyQuantity(),
    })
  }

  const reset = () => {
    setVendorId('')
    setOrderDate(format(new Date(), 'yyyy-MM-dd'))
    setExpectedDate('')
    setNotes('')
    setLines([emptyLine()])
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!currentOrgId) return toast.error('سياق المؤسسة مطلوب')
    if (!uomEnabled) return toast.error('محرك وحدات القياس غير مفعّل للمؤسسة')
    if (!vendorId) return toast.error('اختر المورد')

    const activeLines = lines.filter((line) => line.productId)
    if (activeLines.length === 0) return toast.error('أضف صنفًا واحدًا على الأقل')

    try {
      setLoading(true)
      const normalized = activeLines.map((line) => buildPurchaseOrderUomLinePayload({
        productId: line.productId,
        description: line.description,
        quantityEntered: line.quantity.quantityEntered,
        uomId: line.quantity.uomId,
        factorToBase: line.quantity.factorToBase,
        unitPriceEntered: line.unitPriceEntered,
        discountPercentage: line.discountPercentage,
        taxPercentage: line.taxPercentage,
      }))

      const result = await createAtomicUomPurchaseOrder({
        org_id: currentOrgId,
        vendor_id: vendorId,
        order_date: orderDate,
        expected_delivery_date: expectedDate || null,
        notes: notes.trim() || null,
        lines: normalized.map((line) => ({
          product_id: line.product_id,
          description: line.description,
          uom_id: line.uom_id,
          qty_entered: line.qty_entered,
          unit_price_entered: line.unit_price_entered,
          discount_percentage: line.discount_percentage,
          tax_percentage: line.tax_percentage,
        })),
      })

      toast.success(`تم إنشاء أمر الشراء ${result.order_number}`)
      reset()
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error('Purchase order UoM save failed', error)
      toast.error(mapPurchaseOrderError(error))
    } finally {
      setLoading(false)
    }
  }

  const blocked = flagLoading || !uomEnabled

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>أمر شراء بوحدات القياس</DialogTitle>
          <DialogDescription>
            أدخل الكمية بوحدة المورد؛ يحفظ النظام المستند كاملًا ذريًا ويشتق قيم وحدة الأساس داخل قاعدة البيانات.
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {flagLoading ? 'جاري التحقق من إعداد المحرك...' : 'محرك وحدات القياس غير مفعّل للمؤسسة الحالية.'}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label>المورد *</Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder="اختر المورد" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.code ? `${vendor.code} - ` : ''}{vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>تاريخ الأمر *</Label>
                <Input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>التسليم المتوقع</Label>
                <Input type="date" min={orderDate} value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">سطور الأمر</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptyLine()])}>
                  <Plus className="ms-2 h-4 w-4" /> إضافة سطر
                </Button>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[1100px]">
                  <thead className="bg-muted/60 text-sm">
                    <tr>
                      <th className="p-2 text-right w-[25%]">الصنف</th>
                      <th className="p-2 text-right w-[24%]">الكمية والوحدة</th>
                      <th className="p-2 text-right">سعر الوحدة التجارية</th>
                      <th className="p-2 text-right">خصم %</th>
                      <th className="p-2 text-right">ضريبة %</th>
                      <th className="p-2 text-right">الإجمالي</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.key} className="border-t align-top">
                        <td className="p-2">
                          <Select value={line.productId || undefined} onValueChange={(value) => selectProduct(line, value)}>
                            <SelectTrigger><SelectValue placeholder="اختر الصنف" /></SelectTrigger>
                            <SelectContent>
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>{productLabel(product)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <UomQuantityInput
                            productId={line.productId || null}
                            value={line.quantity}
                            purchaseOnly
                            onChange={(quantity) => updateLine(line.key, { quantity })}
                          />
                        </td>
                        <td className="p-2">
                          <Input type="number" min="0" step="any" value={line.unitPriceEntered} onChange={(event) => updateLine(line.key, { unitPriceEntered: Number.parseFloat(event.target.value) || 0 })} />
                        </td>
                        <td className="p-2">
                          <Input type="number" min="0" max="100" step="0.01" value={line.discountPercentage} onChange={(event) => updateLine(line.key, { discountPercentage: Number.parseFloat(event.target.value) || 0 })} />
                        </td>
                        <td className="p-2">
                          <Input type="number" min="0" max="100" step="0.01" value={line.taxPercentage} onChange={(event) => updateLine(line.key, { taxPercentage: Number.parseFloat(event.target.value) || 0 })} />
                        </td>
                        <td className="p-2 font-semibold whitespace-nowrap">
                          {calculateCommercialLineTotal({
                            quantityEntered: line.quantity.quantityEntered,
                            unitPriceEntered: line.unitPriceEntered,
                            discountPercentage: line.discountPercentage,
                            taxPercentage: line.taxPercentage,
                          }).toFixed(2)} ر.س
                        </td>
                        <td className="p-2">
                          <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_320px]">
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات أمر الشراء" />
              </div>
              <div className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm">
                <div className="flex justify-between"><span>الصافي</span><strong>{totals.subtotal.toFixed(2)} ر.س</strong></div>
                <div className="flex justify-between"><span>الخصم</span><strong>{totals.discount.toFixed(2)} ر.س</strong></div>
                <div className="flex justify-between"><span>الضريبة</span><strong>{totals.tax.toFixed(2)} ر.س</strong></div>
                <div className="flex justify-between border-t pt-2 text-base"><span>الإجمالي</span><strong>{totals.total.toFixed(2)} ر.س</strong></div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>إلغاء</Button>
              <Button type="submit" disabled={loading}>{loading ? 'جاري الحفظ...' : 'حفظ أمر الشراء'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
