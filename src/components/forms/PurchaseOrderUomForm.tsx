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
  listUomPurchaseOrderOptions,
  mapPurchaseOrderError,
  type PurchaseOrderProductOption,
  type PurchaseOrderVendorOption,
} from '@/features/purchasing/purchase-order-service'
import {
  buildPurchaseOrderUomLinePayload,
  calculateCommercialLineAmounts,
} from '@/features/purchasing/purchase-order-uom'
import { useUomEngineEnabled } from '@/hooks/use-uom-engine-enabled'

interface PurchaseOrderFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess?: () => void
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

function productLabel(product: PurchaseOrderProductOption) {
  const name = product.name_ar?.trim() || product.name?.trim() || product.code
  return `${product.code} - ${name}`
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

export function PurchaseOrderForm({ open, onOpenChange, onSuccess }: PurchaseOrderFormProps) {
  const { currentOrgId } = useAuth()
  const { isEnabled: uomEnabled, isLoading: flagLoading } = useUomEngineEnabled()
  const [loading, setLoading] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [vendors, setVendors] = useState<PurchaseOrderVendorOption[]>([])
  const [products, setProducts] = useState<PurchaseOrderProductOption[]>([])
  const [vendorId, setVendorId] = useState('')
  const [orderDate, setOrderDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PurchaseLine[]>([emptyLine()])

  useEffect(() => {
    if (!open || !currentOrgId || !uomEnabled) return
    let cancelled = false

    setOptionsLoading(true)
    void listUomPurchaseOrderOptions(currentOrgId)
      .then((options) => {
        if (cancelled) return
        setVendors(options.vendors)
        setProducts(options.products)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Failed to load selected-org purchase order options', error)
        toast.error(mapPurchaseOrderError(error))
        setVendors([])
        setProducts([])
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [currentOrgId, open, uomEnabled])

  const totals = useMemo(() => {
    const result = lines.reduce(
      (sum, line) => {
        const amounts = calculateCommercialLineAmounts({
          quantityEntered: line.quantity.quantityEntered,
          unitPriceEntered: line.unitPriceEntered,
          discountPercentage: line.discountPercentage,
          taxPercentage: line.taxPercentage,
        })
        return {
          subtotal: sum.subtotal + amounts.subtotal,
          discount: sum.discount + amounts.discount,
          tax: sum.tax + amounts.tax,
          total: sum.total + amounts.total,
        }
      },
      { subtotal: 0, discount: 0, tax: 0, total: 0 },
    )

    return {
      subtotal: roundMoney(result.subtotal),
      discount: roundMoney(result.discount),
      tax: roundMoney(result.tax),
      total: roundMoney(result.total),
    }
  }, [lines])

  const updateLine = (key: string, patch: Partial<PurchaseLine>) => {
    setLines((current) => current.map((line) => (
      line.key === key ? { ...line, ...patch } : line
    )))
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
            {flagLoading
              ? 'جاري التحقق من إعداد المحرك...'
              : 'محرك وحدات القياس غير مفعّل للمؤسسة الحالية.'}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label>المورد *</Label>
                <Select value={vendorId} onValueChange={setVendorId} disabled={optionsLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder={optionsLoading ? 'جاري التحميل...' : 'اختر المورد'} />
                  </SelectTrigger>
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
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(event) => setOrderDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>التسليم المتوقع</Label>
                <Input
                  type="date"
                  min={orderDate}
                  value={expectedDate}
                  onChange={(event) => setExpectedDate(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">سطور الأمر</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((current) => [...current, emptyLine()])}
                >
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
                    {lines.map((line) => {
                      const lineAmounts = calculateCommercialLineAmounts({
                        quantityEntered: line.quantity.quantityEntered,
                        unitPriceEntered: line.unitPriceEntered,
                        discountPercentage: line.discountPercentage,
                        taxPercentage: line.taxPercentage,
                      })

                      return (
                        <tr key={line.key} className="border-t align-top">
                          <td className="p-2">
                            <Select
                              value={line.productId || undefined}
                              onValueChange={(value) => selectProduct(line, value)}
                              disabled={optionsLoading}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="اختر الصنف" />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {productLabel(product)}
                                  </SelectItem>
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
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={line.unitPriceEntered}
                              onChange={(event) => updateLine(line.key, {
                                unitPriceEntered: Number.parseFloat(event.target.value) || 0,
                              })}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={line.discountPercentage}
                              onChange={(event) => updateLine(line.key, {
                                discountPercentage: Number.parseFloat(event.target.value) || 0,
                              })}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={line.taxPercentage}
                              onChange={(event) => updateLine(line.key, {
                                taxPercentage: Number.parseFloat(event.target.value) || 0,
                              })}
                            />
                          </td>
                          <td className="p-2 font-semibold whitespace-nowrap">
                            {lineAmounts.total.toFixed(2)} ر.س
                          </td>
                          <td className="p-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={lines.length === 1}
                              onClick={() => setLines((current) => (
                                current.filter((candidate) => candidate.key !== line.key)
                              ))}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_320px]">
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="ملاحظات أمر الشراء"
                />
              </div>
              <div className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm">
                <div className="flex justify-between">
                  <span>الصافي</span><strong>{totals.subtotal.toFixed(2)} ر.س</strong>
                </div>
                <div className="flex justify-between">
                  <span>الخصم</span><strong>{totals.discount.toFixed(2)} ر.س</strong>
                </div>
                <div className="flex justify-between">
                  <span>الضريبة</span><strong>{totals.tax.toFixed(2)} ر.س</strong>
                </div>
                <div className="flex justify-between border-t pt-2 text-base">
                  <span>الإجمالي</span><strong>{totals.total.toFixed(2)} ر.س</strong>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => onOpenChange(false)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={loading || optionsLoading}>
                {loading ? 'جاري الحفظ...' : 'حفظ أمر الشراء'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
