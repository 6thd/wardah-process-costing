import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading-state'
import {
  getCostPolicy,
  listCostPolicyWorkCenters,
  previewAbsorption,
  withdrawCostPolicyVersion,
  type AbsorptionPreview,
  type CostPolicyVersion,
} from '@/services/mfg-cost-policy-service'
import { costPolicyErrorMessage } from './costPolicyError'
import { COST_POLICY_ADMIN_FREEZE_ACTIVE } from './costPolicyFreeze'
import { costPolicyQueryKey, costPolicyWorkCentersQueryKey } from './queryKeys'

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'

const STATUS_VARIANT: Record<CostPolicyVersion['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  current: 'default',
  scheduled: 'outline',
  superseded: 'secondary',
  withdrawn: 'destructive',
}

/** مدخلات المعاينة كما كُتبت، قبل تحويلها إلى أرقام. */
export interface CostPolicy204PreviewDraft {
  versionId: string
  workCenterId: string
  laborHours: string
  machineHours: string
  recordedCost: string
}

/** ما لم يُرسل بعد في لوحة 204: سبب السحب المفتوح، ومدخلات المعاينة. */
export interface CostPolicy204Drafts {
  withdrawing: { id: string; reason: string } | null
  preview: CostPolicy204PreviewDraft | null
}

/** مؤسسة اللوحة، ومدخلاتها غير المرسلة، كما يعطيها التبويب. */
export interface CostPolicy204Scope {
  orgId: string
  drafts: CostPolicy204Drafts
  updateDrafts: (orgId: string, update: (drafts: CostPolicy204Drafts) => CostPolicy204Drafts) => void
  isCurrent: (orgId: string) => boolean
}

const NO_DRAFTS: CostPolicy204Drafts = { withdrawing: null, preview: null }

/**
 * يحفظ مدخلات لوحة 204 غير المرسلة خارجها، لمؤسسة واحدة هي المختارة. فتبقى حين تُزال اللوحة
 * أثناء فحص 205 ثم تعود، ولا تنتقل إلى مؤسسة أخرى: تحديث لمؤسسة لم تعد مختارة (رد متأخر) يُهمل،
 * ومؤسسة جديدة تبدأ بلا مدخلات.
 */
export function useCostPolicy204Scope(orgId: string | null): { scope: CostPolicy204Scope | null; clear: () => void } {
  const [stored, setStored] = useState<{ orgId: string; drafts: CostPolicy204Drafts } | null>(null)
  const selected = useRef(orgId)
  selected.current = orgId
  const isCurrent = useCallback((id: string) => id === selected.current, [])
  const updateDrafts = useCallback((id: string, update: (drafts: CostPolicy204Drafts) => CostPolicy204Drafts) => {
    setStored(prev => {
      if (id !== selected.current) return prev
      return { orgId: id, drafts: update(prev?.orgId === id ? prev.drafts : NO_DRAFTS) }
    })
  }, [])
  const clear = useCallback(() => setStored(null), [])
  const scope = orgId
    ? { orgId, drafts: stored?.orgId === orgId ? stored.drafts : NO_DRAFTS, updateDrafts, isCurrent }
    : null
  return { scope, clear }
}

/**
 * لوحة 204 كما كانت، وتظهر حين تكون 205 غائبة فقط (التصميم §2 و§3). الإنشاء القديم
 * معطل مع إشعار أثناء الإيقاف الإداري (قرار المالك Q-3 = ب)، فلا يصل من هنا أي استدعاء
 * لـ`rpc_create_mfg_cost_policy_version`. يزال هذا الملف في طلب التنظيف (T10).
 *
 * القراءة والسحب والمعاينة ومراكز العمل للمؤسسة التي يعطيها التبويب، ومفاتيحها تحملها. ورد سحب
 * يصل بعد تبديل المؤسسة يُخزن تحت مؤسسته ولا يظهر منه شيء في المؤسسة الجديدة.
 */
export function CostPolicy204Panel({ scope }: { readonly scope: CostPolicy204Scope }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { orgId, drafts, updateDrafts, isCurrent } = scope
  const policy = useQuery({ queryKey: costPolicyQueryKey(orgId), queryFn: () => getCostPolicy(orgId), retry: false })
  const workCenters = useQuery({
    queryKey: costPolicyWorkCentersQueryKey(orgId), queryFn: () => listCostPolicyWorkCenters(orgId), enabled: policy.isSuccess,
  })
  const withdrawing = drafts.withdrawing
  const setWithdrawing = (value: CostPolicy204Drafts['withdrawing']) => updateDrafts(orgId, d => ({ ...d, withdrawing: value }))

  const withdraw = useMutation({
    mutationFn: (vars: { orgId: string; id: string; reason: string }) => withdrawCostPolicyVersion(vars.orgId, vars.id, vars.reason),
    onSuccess: (state, vars) => {
      queryClient.setQueryData(costPolicyQueryKey(vars.orgId), state)
      if (!isCurrent(vars.orgId)) return
      updateDrafts(vars.orgId, d => ({ ...d, withdrawing: null }))
      toast.success(t('manufacturingSettings.costPolicy.withdrawn'))
    },
    onError: (error, vars) => {
      if (isCurrent(vars.orgId)) toast.error(costPolicyErrorMessage(t, error))
    },
  })

  if (policy.isLoading) return <LoadingSpinner />
  if (policy.isError) {
    return (
      <Alert variant={policy.error.message === 'COST_POLICY_NOT_DEPLOYED' ? 'default' : 'destructive'}>
        <AlertDescription>{costPolicyErrorMessage(t, policy.error)}</AlertDescription>
      </Alert>
    )
  }
  const state = policy.data
  if (!state) return null

  const live = state.versions.filter(v => v.status !== 'withdrawn')
  const canWithdraw = (v: CostPolicyVersion) =>
    state.canManage && v.status !== 'withdrawn' && v.status !== 'superseded'
    && v.pinned_order_count === 0 && v.awaiting_start_order_count === 0 && v.effective_from >= state.today
  // A kept reason is shown again only while its version can still be withdrawn.
  const openWithdrawal = withdrawing && state.versions.some(v => v.id === withdrawing.id && canWithdraw(v)) ? withdrawing : null

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>{t('manufacturingSettings.costPolicy.scopeNotice')}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{t('manufacturingSettings.costPolicy.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('manufacturingSettings.costPolicy.description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('manufacturingSettings.costPolicy.stageMethod')}</dt>
              <dd>{t('manufacturingSettings.costPolicy.methods.weighted_average')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('manufacturingSettings.costPolicy.inventoryValuation')}</dt>
              <dd>{t('manufacturingSettings.costPolicy.inventoryValuationNote')}</dd>
            </div>
          </dl>

          {state.versions.length === 0 ? (
            <p role="status">{t('manufacturingSettings.costPolicy.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">{t('manufacturingSettings.costPolicy.effectiveFrom')}</th>
                    <th className="p-2 text-start">{t('manufacturingSettings.gl.status')}</th>
                    <th className="p-2 text-start">{t('manufacturingSettings.costPolicy.laborSource')}</th>
                    <th className="p-2 text-start">{t('manufacturingSettings.costPolicy.pinEvent')}</th>
                    <th className="p-2 text-start">{t('manufacturingSettings.costPolicy.pools')}</th>
                    <th className="p-2 text-start">{t('manufacturingSettings.costPolicy.workCenterRules')}</th>
                    <th className="p-2 text-start">{t('manufacturingSettings.costPolicy.pinnedOrders')}</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {state.versions.map(v => (
                    <tr key={v.id} className="border-b align-top" data-testid={`cp-version-${v.version_no}`}>
                      <td className="p-2">{v.version_no}</td>
                      <td className="p-2">{v.effective_from}</td>
                      <td className="p-2">
                        <Badge variant={STATUS_VARIANT[v.status]}>{t(`manufacturingSettings.costPolicy.status.${v.status}`)}</Badge>
                        {v.withdraw_reason && <p className="text-xs text-muted-foreground">{v.withdraw_reason}</p>}
                      </td>
                      <td className="p-2">
                        {t(`manufacturingSettings.costPolicy.laborSources.${v.labor_cost_source}`)}
                        {v.default_labor_rate_per_hour !== null && (
                          <span className="block text-xs">{t('manufacturingSettings.costPolicy.perHour', { rate: v.default_labor_rate_per_hour })}</span>
                        )}
                      </td>
                      <td className="p-2">{t(`manufacturingSettings.costPolicy.pinEvents.${v.pin_event}`)}</td>
                      <td className="p-2">
                        {v.overhead_pools.map(p => (
                          <span key={p.pool_code} className="block text-xs">
                            <span className="font-mono">{p.pool_code}</span>
                            {' · '}{t(`manufacturingSettings.costPolicy.bases.${p.basis}`)}
                            {' · '}{t('manufacturingSettings.costPolicy.perHour', { rate: p.rate })}
                          </span>
                        ))}
                      </td>
                      <td className="p-2">{v.work_center_rules.length}</td>
                      <td className="p-2">
                        {v.pinned_order_count}
                        {v.awaiting_start_order_count > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {t('manufacturingSettings.costPolicy.awaitingStart', { count: v.awaiting_start_order_count })}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {canWithdraw(v) && (
                          <Button size="sm" variant="outline" onClick={() => setWithdrawing({ id: v.id, reason: '' })}>
                            {t('manufacturingSettings.costPolicy.withdraw')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {openWithdrawal && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); withdraw.mutate({ orgId, ...openWithdrawal }) }}>
              <div className="flex-1 space-y-1">
                <Label htmlFor="cp-withdraw-reason">{t('manufacturingSettings.costPolicy.withdrawReason')}</Label>
                <Input id="cp-withdraw-reason" required maxLength={500} value={openWithdrawal.reason}
                  onChange={(e) => setWithdrawing({ ...openWithdrawal, reason: e.target.value })} />
              </div>
              <Button type="submit" variant="destructive" disabled={withdraw.isPending}>
                {t('manufacturingSettings.costPolicy.confirmWithdraw')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setWithdrawing(null)}>{t('manufacturingSettings.cancel')}</Button>
            </form>
          )}

          {state.canManage && COST_POLICY_ADMIN_FREEZE_ACTIVE && (
            <div className="space-y-2">
              <Button disabled aria-describedby="cp-create-frozen">{t('manufacturingSettings.costPolicy.newVersion')}</Button>
              <p id="cp-create-frozen" role="note" className="text-sm text-muted-foreground">
                {t('manufacturingSettings.costPolicy.createFrozen')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {live.length > 0 && (
        <AbsorptionPreviewCard orgId={orgId} versions={live} workCenters={workCenters.data ?? []}
          draft={drafts.preview} onDraft={(preview) => updateDrafts(orgId, d => ({ ...d, preview }))} />
      )}
    </div>
  )
}

// The preview inputs live with the tab, so they outlast a new 205 check; a kept version no longer live falls back to the first.
function previewDraftFor(draft: CostPolicy204PreviewDraft | null, versions: readonly CostPolicyVersion[]): CostPolicy204PreviewDraft {
  return {
    versionId: draft && versions.some(v => v.id === draft.versionId) ? draft.versionId : versions[0]?.id ?? '',
    workCenterId: draft?.workCenterId ?? '',
    laborHours: draft?.laborHours ?? '',
    machineHours: draft?.machineHours ?? '',
    recordedCost: draft?.recordedCost ?? '',
  }
}

function AbsorptionPreviewCard({ orgId, versions, workCenters, draft, onDraft }: {
  readonly orgId: string
  readonly versions: readonly CostPolicyVersion[]
  readonly workCenters: ReadonlyArray<{ id: string; code: string; name: string; nameAr: string | null }>
  readonly draft: CostPolicy204PreviewDraft | null
  readonly onDraft: (draft: CostPolicy204PreviewDraft) => void
}) {
  const { t } = useTranslation()
  const current = previewDraftFor(draft, versions)
  const { versionId, workCenterId, laborHours, machineHours, recordedCost } = current
  const set = (patch: Partial<CostPolicy204PreviewDraft>) => onDraft({ ...current, ...patch })
  const version = versions.find(v => v.id === versionId)
  const usesRecorded = version?.labor_cost_source === 'recorded_entry_rate'
  // Empty means "not measured" (NULL), which the database refuses; 0 is a measured zero.
  const toNumber = (value: string) => value.trim() === '' ? null : Number(value)

  const inputs = {
    orgId, versionId, workCenterId,
    laborHours: toNumber(laborHours), machineHours: toNumber(machineHours),
    recordedLaborCost: usesRecorded ? toNumber(recordedCost) : null,
  }
  const preview = useMutation({ mutationFn: ({ orgId: forOrg, ...vars }: typeof inputs) => previewAbsorption(forOrg, vars) })
  // A result (or error) is shown only for the exact inputs it was computed from. Any change to the
  // version, work center or a driver hides it, so an old figure never sits under new inputs; this
  // also covers a response that arrives after the inputs changed, and one for another organization.
  const matchesInputs = preview.variables !== undefined && JSON.stringify(preview.variables) === JSON.stringify(inputs)
  const result: AbsorptionPreview | undefined = matchesInputs ? preview.data : undefined
  const stale = !matchesInputs && (preview.data !== undefined || preview.isError)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('manufacturingSettings.costPolicy.preview.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('manufacturingSettings.costPolicy.preview.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); preview.mutate(inputs) }}>
          <select aria-label={t('manufacturingSettings.costPolicy.preview.version')} className={SELECT_CLASS}
            value={versionId} onChange={(e) => set({ versionId: e.target.value })}>
            {versions.map(v => <option key={v.id} value={v.id}>#{v.version_no} · {v.effective_from}</option>)}
          </select>
          <select aria-label={t('manufacturingSettings.costPolicy.form.workCenter')} className={SELECT_CLASS} required
            value={workCenterId} onChange={(e) => set({ workCenterId: e.target.value })}>
            <option value="">{t('manufacturingSettings.gl.choose')}</option>
            {workCenters.map(wc => <option key={wc.id} value={wc.id}>{wc.code}</option>)}
          </select>
          <Input aria-label={t('manufacturingSettings.costPolicy.preview.laborHours')} type="number" min="0" step="any"
            value={laborHours} onChange={(e) => set({ laborHours: e.target.value })} />
          <Input aria-label={t('manufacturingSettings.costPolicy.preview.machineHours')} type="number" min="0" step="any"
            value={machineHours} onChange={(e) => set({ machineHours: e.target.value })} />
          {usesRecorded && (
            <Input aria-label={t('manufacturingSettings.costPolicy.preview.recordedCost')} type="number" min="0" step="any"
              value={recordedCost} onChange={(e) => set({ recordedCost: e.target.value })} />
          )}
          <Button type="submit" disabled={preview.isPending || !workCenterId}>
            {t('manufacturingSettings.costPolicy.preview.run')}
          </Button>
        </form>
        {matchesInputs && preview.isError && (
          <p role="alert" className="text-sm text-destructive">{costPolicyErrorMessage(t, preview.error)}</p>
        )}
        {stale && <p role="status" className="text-sm text-muted-foreground">{t('manufacturingSettings.costPolicy.preview.stale')}</p>}
        {result && (
          <table className="w-full text-sm" aria-label={t('manufacturingSettings.costPolicy.preview.result')}>
            <tbody>
              <tr className="border-b">
                <td className="p-2">{t('manufacturingSettings.costPolicy.preview.labor')}</td>
                <td className="p-2 text-end">{result.labor.amount.toFixed(2)}</td>
              </tr>
              {result.overhead.map(line => (
                <tr key={line.pool_code} className="border-b">
                  <td className="p-2">
                    <span className="font-mono">{line.pool_code}</span>{' · '}
                    {t('manufacturingSettings.costPolicy.preview.line', { hours: line.driver_hours, rate: line.rate_per_hour })}
                  </td>
                  <td className="p-2 text-end">{line.amount.toFixed(2)}</td>
                </tr>
              ))}
              {result.excluded_pools.map(code => (
                <tr key={code} className="border-b text-muted-foreground">
                  <td className="p-2"><span className="font-mono">{code}</span> · {t('manufacturingSettings.costPolicy.preview.excluded')}</td>
                  <td className="p-2 text-end">—</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="p-2">{t('manufacturingSettings.costPolicy.preview.total')}</td>
                <td className="p-2 text-end">{result.total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
