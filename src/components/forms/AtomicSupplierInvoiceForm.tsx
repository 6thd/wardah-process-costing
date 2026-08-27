import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { CalendarIcon, CheckCircle2, Loader2, Package, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { resolveOrgIdWithFallback } from '@/lib/supabase'
import { mapApError } from '@/services/ap-error-mapper'
import {
  candidateToMatchedLine,
  createMatchedSupplierInvoice,
  listSupplierInvoiceCandidates,
  stableOperationIdentity,
  type StableOperationIdentity,
  type SupplierInvoiceCandidate,
} from '@/services/supplier-invoice-atomic-service'

interface SupplierInvoiceFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess: () => void | Promise<void>
  readonly canApprove: boolean
}

interface CandidateVendor {
  id: string
  code: string
  name: string
}

interface CandidatePurchaseOrder {
  id: string
  orderNumber: string
  status: string
}

function toEnglishDigits(value: string | number): string {
  return String(value).replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit).toString())
}

function money(value: number): string {
  return toEnglishDigits(value.toFixed(2))
}

function lineNet(candidate: SupplierInvoiceCandidate): number {
  return candidate.remaining_qty_base
    * candidate.po_unit_price_base
    * (1 - candidate.discount_percentage / 100)
}

function lineTax(candidate: SupplierInvoiceCandidate): number {
  return lineNet(candidate) * candidate.tax_percentage / 100
}

export function SupplierInvoiceForm({
  open,
  onOpenChange,
  onSuccess,
  canApprove,
}: SupplierInvoiceFormProps) {
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [posting, setPosting] = useState(false)
  const [orgId, setOrgId] = useState('')
  const [candidates, setCandidates] = useState<SupplierInvoiceCandidate[]>([])
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [selectedPOId, setSelectedPOId] = useState('')
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState<Date>(new Date())
  const [dueDate, setDueDate] = useState<Date | undefined>()
  const [previewReady, setPreviewReady] = useState(false)
  const operationIdentityRef = useRef<StableOperationIdentity | null>(null)

  const resetForm = () => {
    setCandidates([])
    setOrgId('')
    setSelectedVendorId('')
    setSelectedPOId('')
    setSelectedLineIds([])
    setInvoiceNumber('')
    setInvoiceDate(new Date())
    setDueDate(undefined)
    setPreviewReady(false)
    operationIdentityRef.current = null
  }

  const showMappedError = (error: unknown) => {
    const mapped = mapApError(error)
    console.error(`[${mapped.code}]`, mapped.technicalDetails ?? error)
    toast.error(mapped.title, { description: mapped.description })
  }

  const loadCandidates = async () => {
    setLoadingCandidates(true)
    try {
      const resolvedOrgId = await resolveOrgIdWithFallback()
      const data = await listSupplierInvoiceCandidates({ orgId: resolvedOrgId })
      setOrgId(resolvedOrgId)
      setCandidates(data)

      // Candidate refresh never changes a logical operation key by itself. It
      // only invalidates UI selections that are no longer legal candidates.
      const validIds = new Set(data.map((candidate) => candidate.goods_receipt_line_id))
      setSelectedLineIds((current) => current.filter((id) => validIds.has(id)))

      if (data.length === 0) {
        toast.info('لا توجد استلامات مقبولة قابلة للفوترة حاليًا')
      }
    } catch (error) {
      setCandidates([])
      showMappedError(error)
    } finally {
      setLoadingCandidates(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void loadCandidates()
    // Loading is intentionally tied to opening the dialog only. Candidate
    // filtering below is local over the server-authorized snapshot set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setSelectedPOId('')
    setSelectedLineIds([])
    setPreviewReady(false)
  }, [selectedVendorId])

  useEffect(() => {
    setSelectedLineIds([])
    setPreviewReady(false)
  }, [selectedPOId])

  useEffect(() => {
    setPreviewReady(false)
  }, [invoiceNumber, invoiceDate, dueDate, selectedLineIds])

  const vendors = useMemo<CandidateVendor[]>(() => {
    const unique = new Map<string, CandidateVendor>()
    for (const candidate of candidates) {
      unique.set(candidate.vendor_id, candidate.vendor)
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [candidates])

  const purchaseOrders = useMemo<CandidatePurchaseOrder[]>(() => {
    if (!selectedVendorId) return []
    const unique = new Map<string, CandidatePurchaseOrder>()
    for (const candidate of candidates) {
      if (candidate.vendor_id !== selectedVendorId) continue
      unique.set(candidate.purchase_order_id, {
        id: candidate.purchase_order_id,
        orderNumber: candidate.purchase_order_number,
        status: candidate.purchase_order_status,
      })
    }
    return [...unique.values()].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))
  }, [candidates, selectedVendorId])

  const poCandidates = useMemo(() => (
    candidates.filter((candidate) =>
      candidate.vendor_id === selectedVendorId
      && candidate.purchase_order_id === selectedPOId
    )
  ), [candidates, selectedVendorId, selectedPOId])

  const selectedCandidates = useMemo(() => {
    const selected = new Set(selectedLineIds)
    return poCandidates
      .filter((candidate) => selected.has(candidate.goods_receipt_line_id))
      .sort((a, b) => a.goods_receipt_line_id.localeCompare(b.goods_receipt_line_id))
  }, [poCandidates, selectedLineIds])

  const subtotal = selectedCandidates.reduce((sum, candidate) => sum + lineNet(candidate), 0)
  const taxAmount = selectedCandidates.reduce((sum, candidate) => sum + lineTax(candidate), 0)
  const totalAmount = subtotal + taxAmount

  const validatePreview = (): boolean => {
    if (!orgId) {
      toast.error('تعذر تحديد المؤسسة الحالية')
      return false
    }
    if (!selectedVendorId) {
      toast.error('اختر موردًا من الاستلامات المرشحة')
      return false
    }
    if (!selectedPOId) {
      toast.error('اختر أمر شراء لديه استلام مقبول')
      return false
    }
    if (selectedCandidates.length === 0) {
      toast.error('اختر سطر استلام مقبولًا واحدًا على الأقل')
      return false
    }
    if (!invoiceNumber.trim()) {
      toast.error('أدخل رقم فاتورة المورد')
      return false
    }
    if (dueDate && dueDate < invoiceDate) {
      toast.error('تاريخ الاستحقاق لا يمكن أن يسبق تاريخ الفاتورة')
      return false
    }
    return true
  }

  const handlePreparePreview = () => {
    if (!validatePreview()) return
    // D3: create permission means local preparation only. This handler is
    // intentionally side-effect free with respect to the database.
    setPreviewReady(true)
    toast.success('تم تجهيز المعاينة محليًا دون حفظ أو ترحيل')
  }

  const logicalRequest = () => ({
    org_id: orgId,
    vendor_id: selectedVendorId,
    invoice_number: invoiceNumber.trim(),
    invoice_date: format(invoiceDate, 'yyyy-MM-dd'),
    due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
    lines: selectedCandidates.map(candidateToMatchedLine),
  })

  const handleApproveAndPost = async () => {
    if (!canApprove) {
      toast.error('لا تملك صلاحية اعتماد وترحيل فواتير الموردين')
      return
    }
    if (!validatePreview()) return

    const request = logicalRequest()
    const fingerprint = JSON.stringify(request)
    const identity = stableOperationIdentity(fingerprint, operationIdentityRef.current)
    operationIdentityRef.current = identity

    setPosting(true)
    try {
      const result = await createMatchedSupplierInvoice({
        ...request,
        idempotency_key: identity.key,
      })

      const replaySuffix = result.idempotent_replay ? ' (إعادة محاولة آمنة)' : ''
      toast.success(`تم اعتماد فاتورة المورد وترحيل قيدها${replaySuffix}`)
      await onSuccess()
      resetForm()
      onOpenChange(false)
    } catch (error) {
      // Keep operationIdentityRef unchanged. An ambiguous retry of the exact
      // same logical request must reuse the same idempotency key.
      showMappedError(error)
    } finally {
      setPosting(false)
    }
  }

  const toggleLine = (id: string, checked: boolean) => {
    setSelectedLineIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter((candidateId) => candidateId !== id)
    })
  }

  const allSelected = poCandidates.length > 0
    && poCandidates.every((candidate) => selectedLineIds.includes(candidate.goods_receipt_line_id))

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !posting) resetForm()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-2xl">فاتورة مورد مطابقة للاستلام</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-lg bg-muted/30 p-2">
            <Button type="button" variant="default" disabled>
              <Package className="ml-2 h-4 w-4" />
              من أمر شراء + استلام مقبول
            </Button>
            <Button type="button" variant="outline" disabled>
              فاتورة مباشرة بدون أمر شراء — غير متاحة في هذه الشريحة
            </Button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            لا يمكن إنشاء فاتورة قبل وجود استلام مقبول، ولا توجد كتابة مباشرة بديلة. المرشحون أدناه صادرون من عقد الخادم المعتمد فقط.
          </div>

          <div className="flex justify-between items-center gap-3">
            <div>
              <h3 className="font-semibold">الاستلامات القابلة للفوترة</h3>
              <p className="text-xs text-muted-foreground">الكمية والسعر ثابتان من Snapshot الخادم ولا يمكن تعديلهما من هذه الشاشة.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void loadCandidates()} disabled={loadingCandidates || posting}>
              {loadingCandidates ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <RefreshCw className="ml-2 h-4 w-4" />}
              تحديث المرشحين
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>المورد *</Label>
              <Select value={selectedVendorId} onValueChange={setSelectedVendorId} disabled={loadingCandidates || posting}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingCandidates ? 'جاري التحميل...' : 'اختر موردًا'} />
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
              <Label>أمر الشراء *</Label>
              <Select value={selectedPOId} onValueChange={setSelectedPOId} disabled={!selectedVendorId || posting}>
                <SelectTrigger>
                  <SelectValue placeholder={purchaseOrders.length ? 'اختر أمر شراء' : 'لا يوجد أمر لديه استلام مقبول'} />
                </SelectTrigger>
                <SelectContent>
                  {purchaseOrders.map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {toEnglishDigits(po.orderNumber)} ({po.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedPOId && poCandidates.length === 0 && (
            <div className="rounded-lg border p-4 text-center text-muted-foreground">
              لا توجد أسطر استلام مقبولة متبقية لهذا الأمر. لا يمكن المتابعة قبل وجود رصيد استلام قانوني.
            </div>
          )}

          {poCandidates.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3">
                <Label className="text-base font-semibold">أسطر الاستلام ({toEnglishDigits(poCandidates.length)})</Label>
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
                  <Checkbox
                    id="supplier-invoice-select-all"
                    checked={allSelected}
                    onCheckedChange={(checked) => {
                      setSelectedLineIds(checked === true
                        ? poCandidates.map((candidate) => candidate.goods_receipt_line_id)
                        : [])
                    }}
                    disabled={posting}
                  />
                  <label htmlFor="supplier-invoice-select-all" className="cursor-pointer text-sm font-medium">تحديد الكل</label>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/70">
                    <tr>
                      <th className="p-3 text-center">✓</th>
                      <th className="p-3 text-right">المنتج / الاستلام</th>
                      <th className="p-3 text-center">الرصيد المتبقي</th>
                      <th className="p-3 text-center">سعر PO</th>
                      <th className="p-3 text-center">ضريبة</th>
                      <th className="p-3 text-center">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {poCandidates.map((candidate) => {
                      const checked = selectedLineIds.includes(candidate.goods_receipt_line_id)
                      const uomLabel = candidate.uom.symbol || candidate.uom.name_ar || candidate.uom.name
                      const total = lineNet(candidate) + lineTax(candidate)
                      return (
                        <tr key={candidate.goods_receipt_line_id} className="hover:bg-accent/40">
                          <td className="p-3 text-center">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => toggleLine(candidate.goods_receipt_line_id, value === true)}
                              disabled={posting}
                            />
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{candidate.product.name_ar || candidate.product.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {candidate.product.code} · {candidate.goods_receipt_number}
                            </div>
                          </td>
                          <td className="p-3 text-center font-mono">
                            {toEnglishDigits(candidate.remaining_qty_entered)} {uomLabel}
                            <div className="text-[11px] text-muted-foreground">
                              أساس: {toEnglishDigits(candidate.remaining_qty_base)}
                            </div>
                          </td>
                          <td className="p-3 text-center font-mono">
                            {money(candidate.po_unit_price_entered)} ر.س / {uomLabel}
                            <div className="text-[11px] text-muted-foreground">
                              أساس: {money(candidate.po_unit_price_base)}
                            </div>
                          </td>
                          <td className="p-3 text-center font-mono">{toEnglishDigits(candidate.tax_percentage)}%</td>
                          <td className="p-3 text-center font-mono font-semibold">{money(total)} ر.س</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-muted/30 p-4 space-y-4">
            <h3 className="font-semibold">بيانات فاتورة المورد</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>رقم فاتورة المورد *</Label>
                <Input
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  placeholder="رقم المستند لدى المورد"
                  disabled={posting}
                />
              </div>
              <div className="space-y-2">
                <Label>تاريخ الفاتورة *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" disabled={posting} className={cn('w-full justify-start text-right font-normal', !invoiceDate && 'text-muted-foreground')}>
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {format(invoiceDate, 'dd/MM/yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent mode="single" selected={invoiceDate} onSelect={(date) => date && setInvoiceDate(date)} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>تاريخ الاستحقاق</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" disabled={posting} className="w-full justify-start text-right font-normal">
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {dueDate ? format(dueDate, 'dd/MM/yyyy') : 'اختياري'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent mode="single" selected={dueDate} onSelect={setDueDate} disabled={(date) => date < invoiceDate} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {selectedCandidates.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold">المعاينة المالية</h4>
                {previewReady && <Badge variant="secondary"><CheckCircle2 className="ml-1 h-3 w-3" /> مجهزة محليًا</Badge>}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>عدد الأسطر</span><strong>{toEnglishDigits(selectedCandidates.length)}</strong></div>
                <div className="flex justify-between"><span>الصافي قبل الضريبة</span><strong>{money(subtotal)} ر.س</strong></div>
                <div className="flex justify-between"><span>ضريبة المدخلات</span><strong>{money(taxAmount)} ر.س</strong></div>
                <div className="flex justify-between border-t pt-2 text-base"><span>الإجمالي المتوقع</span><strong>{money(totalAmount)} ر.س</strong></div>
              </div>
            </div>
          )}

          {!canApprove && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              لديك صلاحية تجهيز الطلب ومعاينته فقط. لا يتم حفظ مسودة في قاعدة البيانات، ويتطلب الاعتماد والترحيل صلاحية <span className="font-mono">purchasing.purchase_invoices.approve</span>.
            </div>
          )}

          <div className="flex flex-wrap gap-3 border-t pt-4">
            <Button type="button" variant="outline" onClick={handlePreparePreview} disabled={posting || loadingCandidates}>
              تجهيز المعاينة
            </Button>

            {canApprove && (
              <Button type="button" onClick={() => void handleApproveAndPost()} disabled={posting || loadingCandidates}>
                {posting ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="ml-2 h-4 w-4" />}
                اعتماد وترحيل
              </Button>
            )}

            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={posting}>
              إلغاء
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
