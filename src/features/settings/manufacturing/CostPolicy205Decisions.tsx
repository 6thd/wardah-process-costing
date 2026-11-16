import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  isStaleDraft,
  type CostPolicy205State,
  type CostPolicyDraft205,
} from '@/services/mfg-cost-policy-205-service'
import {
  approveDraft205,
  checkDraft205,
  rejectDraft205,
  updateVersionDraft205,
  withdrawDraft205,
  type CheckInput205,
  type DraftCheck205,
  type VersionDraftPayload205,
} from '@/services/mfg-cost-policy-205-write-service'
import type { CostPolicyWorkCenter } from '@/services/mfg-cost-policy-service'
import { costPolicy205ErrorMessage } from './costPolicy205Error'
import { emptyPreviewInputs, parsePreviewInputs, PreviewInputs, PreviewResult, useRiyal, type PreviewInputsText } from './CostPolicy205Preview'
import { useCostPolicy205Action } from './useCostPolicy205Action'

const P = 'manufacturingSettings.costPolicy205'

/** سبب إلزامي من 1 إلى 500 حرف، ثم تأكيد. */
export function ReasonForm({ label, confirm, busy, onConfirm, onCancel, testId }: {
  readonly label: string
  readonly confirm: string
  readonly busy: boolean
  readonly onConfirm: (reason: string) => void
  readonly onCancel: () => void
  readonly testId: string
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  return (
    <form className="flex flex-wrap items-end gap-2" data-testid={testId}
      onSubmit={(e) => { e.preventDefault(); onConfirm(reason.trim()) }}>
      <Input aria-label={label} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required className="max-w-md" />
      <Button type="submit" size="sm" disabled={busy || reason.trim() === ''}>{confirm}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t('manufacturingSettings.cancel')}</Button>
    </form>
  )
}

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const rows = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object') : []

/** محتوى المسودة كما ورد في القراءة، للمراجعة قبل القرار. المبالغ كما أُدخلت. */
export function DraftSummary({ draft }: { readonly draft: CostPolicyDraft205 }) {
  const { t } = useTranslation()
  const p = draft.payload
  const pools = rows(draft.kind === 'version' ? p.overhead_pools : p.pools)
  const exception = p.unallocated_exception && typeof p.unallocated_exception === 'object' ? p.unallocated_exception as Record<string, unknown> : null
  return (
    <div className="space-y-1 text-xs" data-testid={`cp205-summary-${draft.id}`}>
      {draft.kind === 'version' && (
        <p>{t('manufacturingSettings.costPolicy.effectiveFrom')}: {str(p.effective_from)} · {t(`manufacturingSettings.costPolicy.laborSources.${str(p.labor_cost_source) || 'work_center_rate'}`)}
          {str(p.default_labor_rate_per_hour) && ` · ${t('manufacturingSettings.costPolicy.perHour', { rate: str(p.default_labor_rate_per_hour) })}`}</p>
      )}
      {pools.map(pool => (
        <p key={str(pool.pool_code)}>
          <span className="font-mono">{str(pool.pool_code)}</span>
          {str(pool.rate) && ` · ${t('manufacturingSettings.costPolicy.perHour', { rate: str(pool.rate) })}`}
          {str(pool.activity) && ` · ${t(`${P}.activities.${str(pool.activity)}`)}`}
          {' · '}{t(`${P}.summary.loads`)}: {Array.isArray(pool.budgets) && pool.budgets.length > 0 ? pool.budgets.join(', ') : '—'}
        </p>
      ))}
      {rows(p.budgets).map(b => (
        <p key={str(b.budget_code)}>
          <span className="font-mono">{str(b.budget_code)}</span>: {str(b.amount) || '—'}
          {b.setup_related === true && ` · ${t(`${P}.form.setupRelated`)}`}
          {!str(b.gl_account_id) && <span className="text-destructive"> · {t(`${P}.errors.COST_POLICY_BUDGET_ACCOUNT_REQUIRED`)}</span>}
        </p>
      ))}
      {exception && <p>{t(`${P}.reason`)}: {str(exception.reason)} · {t(`${P}.treatment`)}: {str(exception.treatment)}</p>}
    </div>
  )
}

type CheckVars = CheckInput205 & { key: string }

/**
 * فحص المسودة ومعاينتها بالمراجعة المعروضة (§17.6). النتيجة تعرض فقط إذا طابق مفتاحها الحالة
 * والمدخلات؛ وإلا «انتهت صلاحية الفحص». ليست موافقة، وزر الاعتماد لا يعتمد عليها.
 */
export function DraftCheck({ draft, revision, state, workCenters }: {
  readonly draft: CostPolicyDraft205
  readonly revision: number
  readonly state: CostPolicy205State
  readonly workCenters: readonly CostPolicyWorkCenter[]
}) {
  const { t } = useTranslation()
  const riyal = useRiyal()
  const [inputs, setInputs] = useState<PreviewInputsText>(emptyPreviewInputs)
  const labor = draft.kind === 'version' ? draft.payload.labor_cost_source
    : state.versions.find(v => v.id === draft.legacy_version_id)?.labor_cost_source
  const recordedApplies = labor === 'recorded_entry_rate'
  const parsed = parsePreviewInputs(inputs, recordedApplies)
  const liveRevision = state.drafts.find(d => d.id === draft.id)?.revision
  const keyOf = (input: CheckInput205) => JSON.stringify([input, state.latestVersionNo, state.settings])
  const input: CheckInput205 | null = parsed ? {
    draftId: draft.id, revision,
    workCenterId: inputs.workCenterId || null,
    hours: inputs.workCenterId ? parsed.hours : null,
    recordedLaborCost: inputs.workCenterId ? parsed.recorded : null,
  } : null
  const currentKey = input && liveRevision === revision ? keyOf(input) : null
  const check = useMutation({
    mutationFn: async (vars: CheckVars): Promise<{ key: string; result: DraftCheck205 }> => ({ key: vars.key, result: await checkDraft205(state.orgId, vars) }),
  })
  const shownKey = check.data?.key ?? check.variables?.key ?? null
  const matches = currentKey !== null && shownKey === currentKey
  const result = matches ? check.data?.result : undefined
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`cp205-check-${draft.id}`}>
      <p className="font-medium">{t(`${P}.check.title`)}</p>
      <PreviewInputs value={inputs} onChange={setInputs} workCenters={workCenters} recordedApplies={recordedApplies} idPrefix={`cp205-check-${draft.id}`} />
      <Button type="button" size="sm" variant="outline" disabled={!input || check.isPending}
        onClick={() => { if (input) check.mutate({ ...input, key: keyOf(input) }) }}>
        {t(`${P}.check.run`)}
      </Button>
      {matches && check.isError && <p className="text-destructive" role="alert">{costPolicy205ErrorMessage(t, check.error)}</p>}
      {result && (
        <div className="space-y-1 text-sm" data-testid={`cp205-check-result-${draft.id}`}>
          <p className="text-xs text-muted-foreground">{t(`${P}.check.validAtCheck`, { at: result.checkedAt })}</p>
          {result.valid
            ? <p role="status">{t(`${P}.check.valid`, { revision: result.revision })}</p>
            : <p className="text-destructive" role="alert">{t(`${P}.check.refused`)}: {t(`${P}.errors.${result.refusal?.code}`)}{result.refusal?.detail ? ` (${result.refusal.detail})` : ''}</p>}
          {result.unallocated.length > 0 && !result.preview && (
            <div className="rounded-md bg-muted/50 p-2">
              <p className="font-medium">{t(`${P}.unallocatedTitle`)}</p>
              {result.unallocated.map(b => <p key={b.budget_code}><span className="font-mono">{b.budget_code}</span>: {riyal(b.amount)}</p>)}
            </div>
          )}
          {result.preview && <PreviewResult preview={result.preview} unallocated={result.unallocated} testId={`cp205-check-preview-${draft.id}`} />}
          {result.previewRefusal && (
            <p className="text-destructive">{t(`${P}.check.previewRefused`)}: {t(`${P}.errors.${result.previewRefusal.code}`)}{result.previewRefusal.detail ? ` (${result.previewRefusal.detail})` : ''}</p>
          )}
        </div>
      )}
      {!matches && (check.data || check.isError) && <p className="text-muted-foreground" role="status">{t(`${P}.check.expired`)}</p>}
    </div>
  )
}

type Open = null | 'approve' | 'reject' | 'withdraw'

/**
 * أزرار المسودة المعلقة حسب §5، من `capabilities` للعرض فقط؛ الخادم هو الحكم. نافذة الاعتماد تجمّد
 * لقطة المسودة عند فتحها، وتعرض «توجد نسخة أحدث» إن تغيرت، وترسل مراجعة اللقطة نفسها (§6).
 */
export function PendingDraftActions({ draft, state, workCenters, onEdit }: {
  readonly draft: CostPolicyDraft205
  readonly state: CostPolicy205State
  readonly workCenters: readonly CostPolicyWorkCenter[]
  readonly onEdit: (draft: CostPolicyDraft205) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<Open>(null)
  const [snapshot, setSnapshot] = useState<CostPolicyDraft205 | null>(null)
  const caps = state.capabilities
  const mine = draft.created_by === state.sessionUserId
  const stale = isStaleDraft(draft, state.latestVersionNo)
  const canDecide = mine ? caps.can_self_approve : caps.can_approve
  const close = () => { setOpen(null); setSnapshot(null) }
  const decidedByMe = (fresh: CostPolicy205State, status: CostPolicyDraft205['status']) =>
    fresh.drafts.some(d => d.id === draft.id && d.status === status && d.decided_by === fresh.sessionUserId)

  const approve = useCostPolicy205Action(state.orgId, {
    run: (org, vars: { revision: number }) => approveDraft205(org, draft.id, vars.revision),
    success: (r) => (r?.selfApproved ? t(`${P}.done.selfApproved`) : t(`${P}.done.approved`)),
    // A lost reply: success only if the read shows this draft approved, at the revision sent, by this session.
    confirmed: (fresh, vars) => fresh.drafts.some(d => d.id === draft.id && d.status === 'approved'
      && d.revision === vars.revision && d.decided_by === fresh.sessionUserId),
    onDone: close,
  })
  const reject = useCostPolicy205Action(state.orgId, {
    run: (org, reason: string) => rejectDraft205(org, draft.id, reason),
    success: () => t(`${P}.done.rejected`),
    confirmed: (fresh) => decidedByMe(fresh, 'rejected'),
    onDone: close,
  })
  const withdraw = useCostPolicy205Action(state.orgId, {
    run: (org, reason: string) => withdrawDraft205(org, draft.id, reason),
    success: () => t(`${P}.done.withdrawn`),
    confirmed: (fresh) => decidedByMe(fresh, 'withdrawn'),
    onDone: close,
  })
  const rebase = useCostPolicy205Action(state.orgId, {
    run: (org, latest: number) => updateVersionDraft205(org, draft.id, draft.payload as unknown as VersionDraftPayload205, latest),
    success: (r) => (r?.unchanged ? t(`${P}.done.unchanged`) : t(`${P}.done.rebased`)),
  })

  const live = snapshot ? state.drafts.find(d => d.id === snapshot.id) : undefined
  const newer = snapshot !== null && (live === undefined || live.revision !== snapshot.revision || live.status !== 'draft')

  return (
    <div className="space-y-2" data-testid={`cp205-actions-${draft.id}`}>
      <div className="flex flex-wrap gap-2">
        {canDecide && <Button type="button" size="sm" onClick={() => { setSnapshot(draft); setOpen('approve') }}>{t(`${P}.actions.review`)}</Button>}
        {caps.can_approve && <Button type="button" size="sm" variant="outline" onClick={() => setOpen('reject')}>{t(`${P}.actions.reject`)}</Button>}
        {mine && caps.can_create && draft.kind === 'version' && <Button type="button" size="sm" variant="outline" onClick={() => onEdit(draft)}>{t(`${P}.actions.edit`)}</Button>}
        {mine && caps.can_create && stale && (
          <Button type="button" size="sm" variant="outline" disabled={rebase.isPending} onClick={() => rebase.mutate(state.latestVersionNo)}>
            {t(`${P}.actions.rebase`, { latest: state.latestVersionNo })}
          </Button>
        )}
        {mine && <Button type="button" size="sm" variant="ghost" onClick={() => setOpen('withdraw')}>{t(`${P}.actions.withdraw`)}</Button>}
      </div>
      {mine && !caps.can_self_approve && caps.can_approve && <p className="text-xs text-muted-foreground">{t(`${P}.actions.selfApprovalOff`)}</p>}
      {open === 'reject' && (
        <ReasonForm label={t(`${P}.actions.rejectReason`)} confirm={t(`${P}.actions.confirmReject`)} busy={reject.isPending}
          onConfirm={(r) => reject.mutate(r)} onCancel={close} testId={`cp205-reject-${draft.id}`} />
      )}
      {open === 'withdraw' && (
        <ReasonForm label={t(`${P}.actions.withdrawReason`)} confirm={t(`${P}.actions.confirmWithdraw`)} busy={withdraw.isPending}
          onConfirm={(r) => withdraw.mutate(r)} onCancel={close} testId={`cp205-withdraw-${draft.id}`} />
      )}
      {open === 'approve' && snapshot && (
        <div className="space-y-2 rounded-md border-2 p-3" role="region" aria-label={t(`${P}.approve.aria`)} data-testid={`cp205-approve-${draft.id}`}>
          <p className="font-medium">{t(`${P}.approve.title`, { revision: snapshot.revision })}</p>
          <DraftSummary draft={snapshot} />
          {snapshot.unallocated_budgets.length > 0 && (
            <p className="text-xs">{t(`${P}.approve.unallocated.${state.settings.unallocatedBudgetPolicy}`)}</p>
          )}
          {newer && <p className="text-destructive" role="alert">{t(`${P}.approve.newer`)}</p>}
          {stale && <p className="text-destructive" role="note">{t(`${P}.approve.staleDisabled`)}</p>}
          <DraftCheck draft={snapshot} revision={snapshot.revision} state={state} workCenters={workCenters} />
          <p className="text-xs text-muted-foreground">{t(`${P}.approve.serverRechecks`)}</p>
          <div className="flex gap-2">
            <Button type="button" disabled={approve.isPending || stale || newer} onClick={() => approve.mutate({ revision: snapshot.revision })}>
              {t(`${P}.approve.confirm`, { revision: snapshot.revision })}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>{t('manufacturingSettings.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
