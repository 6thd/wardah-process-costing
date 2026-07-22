import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useUomEngineEnabled } from '@/hooks/use-uom-engine-enabled'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  assignProductBaseUom,
  ignoreUomBackfillIssue,
  listOpenUomBackfillIssues,
  listUnmappedProducts,
  listUomCatalog,
  resolveUomBackfillIssue,
  type UomBackfillIssue,
} from '@/services/uom-master-data-service'
import { mapUomError } from '@/services/uom-error-mapper'
import { ProductUomSettings } from './ProductUomSettings'

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'بانتظار المواءمة', className: 'border-amber-500 text-amber-600' },
  AMBIGUOUS: { label: 'وحدة غير محسومة', className: 'border-orange-500 text-orange-600' },
  NO_UNIT: { label: 'بلا وحدة', className: 'border-red-500 text-red-600' },
}

const ISSUE_CODE_COPY: Record<string, string> = {
  UNIT_MISSING: 'وحدة مفقودة',
  UNIT_AMBIGUOUS_OR_UNKNOWN: 'وحدة غير معروفة أو ملتبسة',
  BOM_UOM_UNRESOLVED: 'وحدة قائمة مواد غير محسومة',
}

function displayName(nameAr: string | null | undefined, name: string) {
  return nameAr || name
}

function issueCodeLabel(code: string) {
  return ISSUE_CODE_COPY[code] ?? code
}

export function UomBackfillIssues() {
  const { currentOrgId } = useAuth()
  const { isEnabled, isLoading: isFlagLoading } = useUomEngineEnabled()
  const queryClient = useQueryClient()

  const [baseUomByProduct, setBaseUomByProduct] = useState<Record<string, string>>({})
  const [issueDialog, setIssueDialog] = useState<
    { issue: UomBackfillIssue; mode: 'resolve' | 'ignore' } | null
  >(null)
  const [note, setNote] = useState('')
  const [resolvedUomId, setResolvedUomId] = useState('')

  const productsQuery = useQuery({
    queryKey: ['uom-unmapped-products', currentOrgId],
    queryFn: () => listUnmappedProducts(currentOrgId as string),
    enabled: isEnabled && Boolean(currentOrgId),
  })

  const issuesQuery = useQuery({
    queryKey: ['uom-open-backfill-issues', currentOrgId],
    queryFn: () => listOpenUomBackfillIssues(currentOrgId as string),
    enabled: isEnabled && Boolean(currentOrgId),
  })

  const catalogQuery = useQuery({
    queryKey: ['uom-catalog', currentOrgId],
    queryFn: () => listUomCatalog(currentOrgId as string),
    enabled: isEnabled && Boolean(currentOrgId),
    staleTime: 10 * 60 * 1000,
  })

  const standardUoms = useMemo(
    () => (catalogQuery.data?.uoms ?? []).filter((uom) => !uom.is_product_specific),
    [catalogQuery.data],
  )

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['uom-unmapped-products', currentOrgId] }),
      queryClient.invalidateQueries({ queryKey: ['uom-open-backfill-issues', currentOrgId] }),
    ])
  }

  const assignMutation = useMutation({
    mutationFn: async (input: { productId: string; uomId: string }) => {
      if (!currentOrgId) throw new Error('ORG_CONTEXT_REQUIRED')
      await assignProductBaseUom({ orgId: currentOrgId, productId: input.productId, uomId: input.uomId })
    },
    onSuccess: async () => {
      toast.success('تم تعيين وحدة الأساس وإغلاق المشكلة')
      await refreshAll()
    },
    onError: (error) => {
      const mapped = mapUomError(error, 'ar')
      toast.error(mapped.title, { description: mapped.description })
    },
  })

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrgId || !issueDialog) throw new Error('UOM_BACKFILL_ISSUE_REQUIRED')
      if (issueDialog.mode === 'resolve') {
        await resolveUomBackfillIssue({
          orgId: currentOrgId,
          issueId: issueDialog.issue.id,
          resolvedUomId: resolvedUomId || null,
          note: note || null,
        })
      } else {
        await ignoreUomBackfillIssue({
          orgId: currentOrgId,
          issueId: issueDialog.issue.id,
          note: note || null,
        })
      }
    },
    onSuccess: async () => {
      toast.success(issueDialog?.mode === 'ignore' ? 'تم تجاهل المشكلة' : 'تم حل المشكلة')
      setIssueDialog(null)
      setNote('')
      setResolvedUomId('')
      await refreshAll()
    },
    onError: (error) => {
      const mapped = mapUomError(error, 'ar')
      toast.error(mapped.title, { description: mapped.description })
    },
  })

  if (isFlagLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <RefreshCw className="ml-2 h-5 w-5 animate-spin" aria-hidden="true" />
        جارٍ التحميل…
      </div>
    )
  }

  if (!isEnabled) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>محرك الوحدات غير مُفعّل</AlertTitle>
        <AlertDescription>هذه الشاشة متاحة فقط عند تفعيل محرك الوحدات لهذه المؤسسة.</AlertDescription>
      </Alert>
    )
  }

  const products = productsQuery.data ?? []
  const issues = issuesQuery.data ?? []
  const loadError = productsQuery.error || issuesQuery.error || catalogQuery.error
  const mappedLoadError = loadError ? mapUomError(loadError, 'ar') : null

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="إصلاح وحدات الأصناف"
        description="عيّن وحدة الأساس القانونية للأصناف غير المحسومة، وأغلق مشكلات مواءمة الوحدات."
        hideOnPrint={false}
      />

      {mappedLoadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{mappedLoadError.title}</AlertTitle>
          <AlertDescription>{mappedLoadError.description}</AlertDescription>
        </Alert>
      )}

      {/* Products needing a base unit */}
      <section className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <h3 className="font-semibold">أصناف تحتاج إعداد وحدة ({products.length})</h3>
          <p className="text-sm text-muted-foreground">
            اختر وحدة معيارية (غير خاصة بالصنف) وعيّنها كوحدة أساس. لا يمكن التعيين بعد تسجيل حركة مخزون.
          </p>
        </div>
        {productsQuery.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">جارٍ تحميل الأصناف…</div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Wrench aria-hidden="true" />}
            title="لا توجد أصناف غير محسومة"
            description="كل الأصناف تملك وحدة أساس قانونية."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-right">الكود</th>
                  <th className="p-3 text-right">الاسم</th>
                  <th className="p-3 text-right">الوحدة الأصلية</th>
                  <th className="p-3 text-center">الحالة</th>
                  <th className="p-3 text-right">وحدة الأساس</th>
                  <th className="p-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {products.map((product) => {
                  const status = STATUS_COPY[product.uom_migration_status] ?? {
                    label: product.uom_migration_status,
                    className: '',
                  }
                  const draft = baseUomByProduct[product.id] ?? ''
                  return (
                    <tr key={product.id} className="hover:bg-muted/30">
                      <td className="p-3 font-mono">{product.code ?? '—'}</td>
                      <td className="p-3">{displayName(product.name_ar, product.name)}</td>
                      <td className="p-3 text-muted-foreground">{product.unit || '—'}</td>
                      <td className="p-3 text-center">
                        <Badge variant="outline" className={status.className}>{status.label}</Badge>
                      </td>
                      <td className="p-3">
                        <Select
                          value={draft}
                          onValueChange={(value) =>
                            setBaseUomByProduct((current) => ({ ...current, [product.id]: value }))
                          }
                        >
                          <SelectTrigger className="min-w-[180px]" aria-label={`وحدة الأساس للصنف ${product.name}`}>
                            <SelectValue placeholder="اختر وحدة الأساس" />
                          </SelectTrigger>
                          <SelectContent>
                            {standardUoms.map((uom) => (
                              <SelectItem key={uom.id} value={uom.id}>
                                {displayName(uom.name_ar, uom.name)} ({uom.symbol})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={!draft || assignMutation.isPending}
                            onClick={() => assignMutation.mutate({ productId: product.id, uomId: draft })}
                          >
                            تعيين
                          </Button>
                          <ProductUomSettings
                            itemId={product.id}
                            productName={displayName(product.name_ar, product.name)}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Open backfill issues */}
      <section className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <h3 className="font-semibold">مشكلات المواءمة المفتوحة ({issues.length})</h3>
          <p className="text-sm text-muted-foreground">
            حل المشكلة بعد إصلاح البيانات، أو تجاهلها عمدًا مع تسجيل السبب والمستخدم.
          </p>
        </div>
        {issuesQuery.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">جارٍ تحميل المشكلات…</div>
        ) : issues.length === 0 ? (
          <EmptyState
            icon={<Wrench aria-hidden="true" />}
            title="لا توجد مشكلات مفتوحة"
            description="تمت معالجة كل مشكلات مواءمة الوحدات."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-right">المصدر</th>
                  <th className="p-3 text-right">القيمة الأصلية</th>
                  <th className="p-3 text-right">نوع المشكلة</th>
                  <th className="p-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {issues.map((issue) => (
                  <tr key={issue.id} className="hover:bg-muted/30">
                    <td className="p-3 font-mono">{issue.source_table}</td>
                    <td className="p-3 text-muted-foreground">{issue.source_value || '—'}</td>
                    <td className="p-3">{issueCodeLabel(issue.issue_code)}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setIssueDialog({ issue, mode: 'resolve' })
                            setNote('')
                            setResolvedUomId('')
                          }}
                        >
                          حل
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setIssueDialog({ issue, mode: 'ignore' })
                            setNote('')
                            setResolvedUomId('')
                          }}
                        >
                          تجاهل
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={issueDialog !== null} onOpenChange={(next) => (next ? null : setIssueDialog(null))}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">
              {issueDialog?.mode === 'ignore' ? 'تجاهل المشكلة' : 'حل المشكلة'}
            </DialogTitle>
            <DialogDescription className="text-right">
              {issueDialog?.mode === 'ignore'
                ? 'سيُسجَّل التجاهل باسمك مع الملاحظة. لا يغيّر هذا بيانات الوحدة.'
                : 'اختياريًا حدد الوحدة التي حُلّت بها المشكلة، وسجّل ملاحظة. سيُسجَّل الحل باسمك.'}
            </DialogDescription>
          </DialogHeader>
          {issueDialog?.mode === 'resolve' && (
            <div className="space-y-2">
              <Label>الوحدة التي حُلّت بها (اختياري)</Label>
              <Select value={resolvedUomId} onValueChange={setResolvedUomId}>
                <SelectTrigger><SelectValue placeholder="بدون وحدة محددة" /></SelectTrigger>
                <SelectContent>
                  {standardUoms.map((uom) => (
                    <SelectItem key={uom.id} value={uom.id}>
                      {displayName(uom.name_ar, uom.name)} ({uom.symbol})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="issue-note">ملاحظة{issueDialog?.mode === 'ignore' ? '' : ' (اختياري)'}</Label>
            <Textarea
              id="issue-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="سبب الحل أو التجاهل"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIssueDialog(null)} disabled={issueMutation.isPending}>
              إلغاء
            </Button>
            <Button
              type="button"
              onClick={() => issueMutation.mutate()}
              disabled={issueMutation.isPending || (issueDialog?.mode === 'ignore' && note.trim() === '')}
            >
              {issueDialog?.mode === 'ignore' ? 'تأكيد التجاهل' : 'تأكيد الحل'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
