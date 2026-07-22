import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings2, Scale, RefreshCw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useUomEngineEnabled } from '@/hooks/use-uom-engine-enabled'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  getProductBaseUomChangeGuard,
  getProductUomMasterProfile,
  listUomCatalog,
  resolveProductIdForItem,
} from '@/services/uom-master-data-service'
import {
  convertProductQuantity,
  saveProductUomConversion,
  setProductPhysicalWeight,
} from '@/services/uom-service'
import { mapUomError } from '@/services/uom-error-mapper'

interface ProductUomSettingsProps {
  readonly itemId: string
  readonly productName: string
  readonly disabled?: boolean
}

interface ConversionDraft {
  uomId: string
  factorToBase: string
  useForPurchase: boolean
  useForSale: boolean
  barcode: string
  notes: string
}

interface WeightDraft {
  netWeight: string
  grossWeight: string
  weightUomId: string
}

const emptyConversion: ConversionDraft = {
  uomId: '',
  factorToBase: '',
  useForPurchase: false,
  useForSale: false,
  barcode: '',
  notes: '',
}

const emptyWeight: WeightDraft = {
  netWeight: '',
  grossWeight: '',
  weightUomId: '',
}

function productUomSettingsKey(orgId: string, productId: string) {
  return ['product-uom-master-settings', orgId, productId] as const
}

function displayName(nameAr: string | null, name: string) {
  return nameAr || name
}

export function ProductUomSettings({ itemId, productName, disabled = false }: ProductUomSettingsProps) {
  const { currentOrgId } = useAuth()
  const { isEnabled, isLoading: isFlagLoading } = useUomEngineEnabled()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [conversion, setConversion] = useState<ConversionDraft>(emptyConversion)
  const [weight, setWeight] = useState<WeightDraft>(emptyWeight)
  const [simulationQuantity, setSimulationQuantity] = useState('1')
  const [simulationUomId, setSimulationUomId] = useState('')

  const identityQuery = useQuery({
    queryKey: ['item-product-identity', currentOrgId, itemId],
    queryFn: () => resolveProductIdForItem(currentOrgId as string, itemId),
    enabled: open && isEnabled && Boolean(currentOrgId),
    retry: 1,
  })

  const productId = identityQuery.data ?? null

  const profileQuery = useQuery({
    queryKey: productId && currentOrgId ? productUomSettingsKey(currentOrgId, productId) : ['product-uom-master-settings', 'disabled'],
    queryFn: () => getProductUomMasterProfile(currentOrgId as string, productId as string),
    enabled: open && isEnabled && Boolean(currentOrgId && productId),
  })

  const catalogQuery = useQuery({
    queryKey: ['uom-catalog', currentOrgId],
    queryFn: () => listUomCatalog(currentOrgId as string),
    enabled: open && isEnabled && Boolean(currentOrgId),
    staleTime: 10 * 60 * 1000,
  })

  const guardQuery = useQuery({
    queryKey: ['product-base-uom-guard', currentOrgId, productId],
    queryFn: () => getProductBaseUomChangeGuard(currentOrgId as string, productId as string),
    enabled: open && isEnabled && Boolean(currentOrgId && productId),
  })

  useEffect(() => {
    const profile = profileQuery.data
    if (!profile) return
    setWeight({
      netWeight: profile.net_weight == null ? '' : String(profile.net_weight),
      grossWeight: profile.gross_weight == null ? '' : String(profile.gross_weight),
      weightUomId: profile.weight_uom_id ?? '',
    })
    setSimulationUomId(profile.base_uom_id ?? '')
  }, [profileQuery.data])

  const massCategoryIds = useMemo(() => {
    const categories = catalogQuery.data?.categories ?? []
    return new Set(categories.filter((category) => category.dimension === 'mass').map((category) => category.id))
  }, [catalogQuery.data])

  const availableUoms = catalogQuery.data?.uoms ?? []
  const massUoms = availableUoms.filter((uom) => massCategoryIds.has(uom.category_id))

  const refreshProfile = async () => {
    if (!currentOrgId || !productId) return
    await queryClient.invalidateQueries({ queryKey: productUomSettingsKey(currentOrgId, productId) })
  }

  const conversionMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrgId || !productId) throw new Error('PRODUCT_AND_UOM_REQUIRED')
      const factor = Number(conversion.factorToBase)
      await saveProductUomConversion({
        orgId: currentOrgId,
        productId,
        uomId: conversion.uomId,
        factorToBase: factor,
        useForPurchase: conversion.useForPurchase,
        useForSale: conversion.useForSale,
        barcode: conversion.barcode || null,
        notes: conversion.notes || null,
      })
    },
    onSuccess: async () => {
      toast.success('تم حفظ تحويل الوحدة بنجاح')
      setConversion(emptyConversion)
      await refreshProfile()
    },
    onError: (error) => {
      const mapped = mapUomError(error, 'ar')
      toast.error(mapped.title, { description: mapped.description })
    },
  })

  const weightMutation = useMutation({
    mutationFn: async () => {
      if (!productId) throw new Error('PRODUCT_NOT_FOUND')
      await setProductPhysicalWeight({
        productId,
        netWeight: Number(weight.netWeight),
        grossWeight: weight.grossWeight === '' ? null : Number(weight.grossWeight),
        weightUomId: weight.weightUomId,
      })
    },
    onSuccess: async () => {
      toast.success('تم حفظ الوزن الفعلي للصنف')
      await refreshProfile()
    },
    onError: (error) => {
      const mapped = mapUomError(error, 'ar')
      toast.error(mapped.title, { description: mapped.description })
    },
  })

  const simulationQuery = useQuery({
    queryKey: ['uom-simulation', productId, simulationUomId, simulationQuantity],
    queryFn: () => convertProductQuantity({
      productId: productId as string,
      quantity: Number(simulationQuantity),
      uomId: simulationUomId,
    }),
    enabled: false,
    retry: false,
  })

  if (isFlagLoading || !isEnabled) return null

  const loading = identityQuery.isLoading || profileQuery.isLoading || catalogQuery.isLoading || guardQuery.isLoading
  const blockingError = identityQuery.error || profileQuery.error || catalogQuery.error || guardQuery.error
  const mappedBlockingError = blockingError ? mapUomError(blockingError, 'ar') : null
  const profile = profileQuery.data

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Settings2 className="ml-2 h-4 w-4" aria-hidden="true" />
          إعدادات الوحدات
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">إعدادات وحدات القياس — {productName}</DialogTitle>
          <DialogDescription className="text-right">
            التحويلات والوزن محفوظة عبر محرك الوحدات القانوني، ولا تُحسب داخل المتصفح.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="ml-2 h-5 w-5 animate-spin" aria-hidden="true" />
            جارٍ تحميل إعدادات الوحدات…
          </div>
        )}

        {mappedBlockingError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{mappedBlockingError.title}</AlertTitle>
            <AlertDescription>{mappedBlockingError.description}</AlertDescription>
          </Alert>
        )}

        {!loading && !mappedBlockingError && profile && (
          <div className="space-y-6">
            <section className="rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">الوحدة الأساسية القانونية</h3>
                  <p className="text-sm text-muted-foreground">تُخزن جميع كميات المخزون بهذه الوحدة.</p>
                </div>
                {profile.base_uom ? (
                  <Badge variant="secondary" className="text-sm">
                    {displayName(profile.base_uom.name_ar, profile.base_uom.name)} ({profile.base_uom.symbol})
                  </Badge>
                ) : (
                  <Badge variant="destructive">غير محددة</Badge>
                )}
              </div>
              {guardQuery.data?.base_uom_locked && (
                <Alert>
                  <Scale className="h-4 w-4" />
                  <AlertTitle>الوحدة الأساسية مقفلة</AlertTitle>
                  <AlertDescription>
                    توجد حركة مخزون لهذا الصنف؛ لذلك لا يجوز تغيير الوحدة الأساسية من الواجهة.
                  </AlertDescription>
                </Alert>
              )}
            </section>

            <section className="rounded-lg border p-4 space-y-4">
              <div>
                <h3 className="font-semibold">التحويلات الحالية</h3>
                <p className="text-sm text-muted-foreground">كل تعديل ينشئ إصدارًا جديدًا ويغلق الإصدار السابق.</p>
              </div>
              {profile.conversions.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد تحويلات مخصصة للصنف.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-right">الوحدة</th>
                        <th className="p-3 text-right">المعامل إلى الأساسية</th>
                        <th className="p-3 text-center">شراء</th>
                        <th className="p-3 text-center">بيع</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {profile.conversions.map((row) => (
                        <tr key={row.id}>
                          <td className="p-3">{displayName(row.uom.name_ar, row.uom.name)} ({row.uom.symbol})</td>
                          <td className="p-3 font-mono">{row.factor_to_base}</td>
                          <td className="p-3 text-center">{row.use_for_purchase ? 'نعم' : '—'}</td>
                          <td className="p-3 text-center">{row.use_for_sale ? 'نعم' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>الوحدة</Label>
                  <Select value={conversion.uomId} onValueChange={(value) => setConversion((current) => ({ ...current, uomId: value }))}>
                    <SelectTrigger><SelectValue placeholder="اختر الوحدة" /></SelectTrigger>
                    <SelectContent>
                      {availableUoms.map((uom) => (
                        <SelectItem key={uom.id} value={uom.id}>{displayName(uom.name_ar, uom.name)} ({uom.symbol})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uom-factor">المعامل إلى الوحدة الأساسية</Label>
                  <Input id="uom-factor" type="number" min="0" step="any" value={conversion.factorToBase} onChange={(event) => setConversion((current) => ({ ...current, factorToBase: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uom-barcode">الباركود</Label>
                  <Input id="uom-barcode" value={conversion.barcode} onChange={(event) => setConversion((current) => ({ ...current, barcode: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uom-notes">ملاحظات</Label>
                  <Input id="uom-notes" value={conversion.notes} onChange={(event) => setConversion((current) => ({ ...current, notes: event.target.value }))} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={conversion.useForPurchase} onCheckedChange={(checked) => setConversion((current) => ({ ...current, useForPurchase: checked === true }))} />
                  تستخدم في الشراء
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={conversion.useForSale} onCheckedChange={(checked) => setConversion((current) => ({ ...current, useForSale: checked === true }))} />
                  تستخدم في البيع
                </label>
              </div>
              <Button
                type="button"
                onClick={() => conversionMutation.mutate()}
                disabled={!conversion.uomId || Number(conversion.factorToBase) <= 0 || conversionMutation.isPending}
              >
                حفظ التحويل
              </Button>
            </section>

            <section className="rounded-lg border p-4 space-y-4">
              <div>
                <h3 className="font-semibold">الوزن الفعلي للوحدة الأساسية</h3>
                <p className="text-sm text-muted-foreground">يولّد الخادم تحويل الوزن المرتبط بالصنف عند الحفظ.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="net-weight">الوزن الصافي</Label>
                  <Input id="net-weight" type="number" min="0" step="any" value={weight.netWeight} onChange={(event) => setWeight((current) => ({ ...current, netWeight: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gross-weight">الوزن الإجمالي</Label>
                  <Input id="gross-weight" type="number" min="0" step="any" value={weight.grossWeight} onChange={(event) => setWeight((current) => ({ ...current, grossWeight: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>وحدة الوزن</Label>
                  <Select value={weight.weightUomId} onValueChange={(value) => setWeight((current) => ({ ...current, weightUomId: value }))}>
                    <SelectTrigger><SelectValue placeholder="اختر وحدة كتلة" /></SelectTrigger>
                    <SelectContent>
                      {massUoms.map((uom) => (
                        <SelectItem key={uom.id} value={uom.id}>{displayName(uom.name_ar, uom.name)} ({uom.symbol})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => weightMutation.mutate()}
                disabled={Number(weight.netWeight) <= 0 || !weight.weightUomId || weightMutation.isPending}
              >
                حفظ الوزن
              </Button>
            </section>

            <section className="rounded-lg border p-4 space-y-4">
              <div>
                <h3 className="font-semibold">محاكي التحويل</h3>
                <p className="text-sm text-muted-foreground">يتم الحساب بواسطة RPC الخادم.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                <Input type="number" min="0" step="any" value={simulationQuantity} onChange={(event) => setSimulationQuantity(event.target.value)} aria-label="كمية المحاكاة" />
                <Select value={simulationUomId} onValueChange={setSimulationUomId}>
                  <SelectTrigger><SelectValue placeholder="اختر الوحدة" /></SelectTrigger>
                  <SelectContent>
                    {availableUoms.map((uom) => (
                      <SelectItem key={uom.id} value={uom.id}>{displayName(uom.name_ar, uom.name)} ({uom.symbol})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => simulationQuery.refetch()} disabled={!simulationUomId || Number(simulationQuantity) < 0 || simulationQuery.isFetching}>
                  احسب
                </Button>
              </div>
              {simulationQuery.data && (
                <Alert>
                  <AlertTitle>الكمية بالوحدة الأساسية</AlertTitle>
                  <AlertDescription className="font-mono text-base">{simulationQuery.data.base_quantity}</AlertDescription>
                </Alert>
              )}
              {simulationQuery.error && (() => {
                const mapped = mapUomError(simulationQuery.error, 'ar')
                return <Alert variant="destructive"><AlertTitle>{mapped.title}</AlertTitle><AlertDescription>{mapped.description}</AlertDescription></Alert>
              })()}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
