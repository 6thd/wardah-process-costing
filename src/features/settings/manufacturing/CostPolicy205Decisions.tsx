import { useState } from 'react'
import type { TFunction } from 'i18next'
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
  type Refusal205,
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

const CP = 'manufacturingSettings.costPolicy'

/** قاعدة مركز عمل في سطر: سعر العمالة الخاص، ثم كل مجمع بسعره الخاص أو مستبعدًا. */
function ruleLine(t: TFunction, rule: Record<string, unknown>): string {
  const labor = str(rule.labor_rate_per_hour)
  const parts = labor ? [`${t(`${CP}.form.wcLaborRate`)}: ${t(`${CP}.perHour`, { rate: labor })}`] : []
  for (const pool of rows(rule.pools)) {
    const mode = pool.applies === false ? t(`${CP}.form.modes.exclude`) : `${t(`${CP}.form.modes.override`)} ${t(`${CP}.perHour`, { rate: str(pool.rate) })}`
    parts.push(`${str(pool.pool_code)}: ${mode}`)
  }
  return parts.join(' · ')
}

/** قواعد مراكز العمل كما في الحمولة، فلا تتطابق في المراجعة مسودتان تختلفان فيها (Codex P2 على #334). */
function RulesSummary({ rules, workCenters }: { readonly rules: Array<Record<string, unknown>>; readonly workCenters: readonly CostPolicyWorkCenter[] }) {
  const { t } = useTranslation()
  const label = (id: string) => workCenters.find(wc => wc.id === id)?.code ?? id
  if (rules.length === 0) return <p data-testid="cp205-summary-rules">{t(`${CP}.workCenterRules`)}: {t(`${P}.summary.noRules`)}</p>
  return (
    <div data-testid="cp205-summary-rules">
      <p>{t(`${CP}.workCenterRules`)}:</p>
      {rules.map(rule => (
        <p key={str(rule.work_center_id)} className="ps-3">
          <span className="font-mono">{label(str(rule.work_center_id))}</span>: {ruleLine(t, rule)}
        </p>
      ))}
    </div>
  )
}

/** محتوى المسودة كما ورد في القراءة، للمراجعة قبل القرار. المبالغ كما أُدخلت. */
export function DraftSummary({ draft, workCenters }: { readonly draft: CostPolicyDraft205; readonly workCenters: readonly CostPolicyWorkCenter[] }) {
  const { t } = useTranslation()
  const p = draft.payload
  const pools = rows(draft.kind === 'version' ? p.overhead_pools : p.pools)
  const acks = rows(p.setup_acks).map(a => `${str(a.pool_code)}/${str(a.budget_code)}`)
  const exception = p.unallocated_exception && typeof p.unallocated_exception === 'object' ? p.unallocated_exception as Record<string, unknown> : null
  return (
    <div className="space-y-1 text-xs" data-testid={`cp205-summary-${draft.id}`}>
      {draft.kind === 'version' && (
        <p>{t(`${CP}.effectiveFrom`)}: {str(p.effective_from)} · {t(`${CP}.laborSources.${str(p.labor_cost_source) || 'work_center_rate'}`)}
          {str(p.default_labor_rate_per_hour) && ` · ${t(`${CP}.perHour`, { rate: str(p.default_labor_rate_per_hour) })}`}
          {str(p.pin_event) && ` · ${t(`${CP}.pinEvent`)}: ${t(`${CP}.pinEvents.${str(p.pin_event)}`)}`}</p>
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
      {acks.length > 0 && <p>{t(`${P}.summary.acks`)}: {acks.join(', ')}</p>}
      {draft.kind === 'version' && <RulesSummary rules={rows(p.work_center_rules)} workCenters={workCenters} />}
      {exception && <p>{t(`${P}.reason`)}:{str(exception.reason)} · {t(`${P}.treatment`)}: {str(exception.treatment)}</p>}
    </div>
  )
}

type CheckVars = CheckInput205 & { key: string }

/** المدخلات المرسلة للفحص، أو `null` إن كان فيها نص لا يُقرأ. بلا مركز عمل لا تُرسل ساعات ولا تكلفة. */
function checkInputOf(draftId: string, revision: number, inputs: PreviewInputsText, recordedApplies: boolean): CheckInput205 | null {
  const parsed = parsePreviewInputs(inputs, recordedApplies)
  if (!parsed) return null
  const wc = inputs.workCenterId || null
  return { draftId, revision, workCenterId: wc, hours: wc ? parsed.hours : null, recordedLaborCost: wc ? parsed.recorded : null }
}

/** مصدر تكلفة العمالة: من حمولة مسودة الإصدار، أو من الإصدار القديم الذي تعالجه مسودة المعالجة. */
function recordedApplies(draft: CostPolicyDraft205, state: CostPolicy205State): boolean {
  const labor = draft.kind === 'version' ? draft.payload.labor_cost_source
    : state.versions.find(v => v.id === draft.legacy_version_id)?.labor_cost_source
  return labor === 'recorded_entry_rate'
}

/** المراجعة ما زالت هي المعلقة: لا فحص لمسودة حُسمت أو جاءتها مراجعة أحدث (Kimi P3 على #334). */
function isPendingRevision(state: CostPolicy205State, draftId: string, revision: number): boolean {
  const current = state.drafts.find(d => d.id === draftId)
  return current?.revision === revision && current.status === 'draft'
}

function refusalText(t: TFunction, label: string, refusal: Refusal205): string {
  return `${t(label)}: ${t(`${P}.errors.${refusal.code}`)}${refusal.detail ? ` (${refusal.detail})` : ''}`
}

/** نتيجة فحص مطابقة للحالة: صالحة عند وقت الفحص أو مرفوضة، والموازنات غير المحمّلة، والمعاينة إن حُسبت. */
function CheckResult({ result, draftId }: { readonly result: DraftCheck205; readonly draftId: string }) {
  const { t } = useTranslation()
  const riyal = useRiyal()
  return (
    <div className="space-y-1 text-sm" data-testid={`cp205-check-result-${draftId}`}>
      <p className="text-xs text-muted-foreground">{t(`${P}.check.validAtCheck`, { at: result.checkedAt })}</p>
      {result.refusal
        ? <p className="text-destructive" role="alert">{refusalText(t, `${P}.check.refused`, result.refusal)}</p>
        : <p role="status">{t(`${P}.check.valid`, { revision: result.revision })}</p>}
      {result.unallocated.length > 0 && !result.preview && (
        <div className="rounded-md bg-muted/50 p-2">
          <p className="font-medium">{t(`${P}.unallocatedTitle`)}</p>
          {result.unallocated.map(b => <p key={b.budget_code}><span className="font-mono">{b.budget_code}</span>: {riyal(b.amount)}</p>)}
        </div>
      )}
      {result.preview && <PreviewResult preview={result.preview} unallocated={result.unallocated} testId={`cp205-check-preview-${draftId}`} />}
      {result.previewRefusal && <p className="text-destructive">{refusalText(t, `${P}.check.previewRefused`, result.previewRefusal)}</p>}
    </div>
  )
}

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
  const [inputs, setInputs] = useState<PreviewInputsText>(emptyPreviewInputs)
  const recorded = recordedApplies(draft, state)
  const input = checkInputOf(draft.id, revision, inputs, recorded)
  const keyOf = (i: CheckInput205) => JSON.stringify([i, state.latestVersionNo, state.settings])
  const live = isPendingRevision(state, draft.id, revision)
  const currentKey = input && live ? keyOf(input) : null
  const check = useMutation({
    mutationFn: async (vars: CheckVars): Promise<{ key: string; result: DraftCheck205 }> => ({ key: vars.key, result: await checkDraft205(state.orgId, vars) }),
  })
  const shownKey = check.data?.key ?? check.variables?.key ?? null
  const matches = currentKey !== null && shownKey === currentKey
  const stale = !matches && (check.data !== undefined || check.isError)
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`cp205-check-${draft.id}`}>
      <p className="font-medium">{t(`${P}.check.title`)}</p>
      <PreviewInputs value={inputs} onChange={setInputs} workCenters={workCenters} recordedApplies={recorded} idPrefix={`cp205-check-${draft.id}`} />
      <Button type="button" size="sm" variant="outline" disabled={!input || !live || check.isPending}
        onClick={() => { if (input) check.mutate({ ...input, key: keyOf(input) }) }}>
        {t(`${P}.check.run`)}
      </Button>
      {matches && check.isError && <p className="text-destructive" role="alert">{costPolicy205ErrorMessage(t, check.error)}</p>}
      {matches && check.data && <CheckResult result={check.data.result} draftId={draft.id} />}
      {stale && <p className="text-muted-foreground" role="status">{t(`${P}.check.expired`)}</p>}
    </div>
  )
}

type Open = null | 'approve' | 'reject' | 'withdraw'

/**
 * كتابات المسودة الأربع. بعد رد مفقود أو رفض يعيد القراءة، تُحسم النتيجة بالحالة الجديدة: الاعتماد ينجح فقط إذا صارت
 * المسودة `approved` بالمراجعة المرسلة وبيد الجلسة نفسها، والرفض والسحب كذلك بيد الجلسة.
 */
function useDraftDecisions(draft: CostPolicyDraft205, state: CostPolicy205State, close: () => void) {
  const { t } = useTranslation()
  const decidedByMe = (fresh: CostPolicy205State, status: CostPolicyDraft205['status']) =>
    fresh.drafts.some(d => d.id === draft.id && d.status === status && d.decided_by === fresh.sessionUserId)
  const approve = useCostPolicy205Action(state.orgId, {
    run: (org, vars: { revision: number }) => approveDraft205(org, draft.id, vars.revision),
    success: (r) => (r?.selfApproved ? t(`${P}.done.selfApproved`) : t(`${P}.done.approved`)),
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
  return { approve, reject, withdraw, rebase }
}

/** الأزرار حسب §5: الاعتماد للمعتمِد (أو للمنشئ بالاعتماد الذاتي)، والرفض لحامل `approve`، والتعديل والتحديث والسحب للمنشئ. */
function DraftActionButtons({ draft, state, onOpen, onEdit, onRebase, rebasing }: {
  readonly draft: CostPolicyDraft205
  readonly state: CostPolicy205State
  readonly onOpen: (open: Exclude<Open, null>) => void
  readonly onEdit: (draft: CostPolicyDraft205) => void
  readonly onRebase: () => void
  readonly rebasing: boolean
}) {
  const { t } = useTranslation()
  const caps = state.capabilities
  const mine = draft.created_by === state.sessionUserId
  const canDecide = mine ? caps.can_self_approve : caps.can_approve
  const ownsVersion = mine && caps.can_create
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canDecide && <Button type="button" size="sm" onClick={() => onOpen('approve')}>{t(`${P}.actions.review`)}</Button>}
        {caps.can_approve && <Button type="button" size="sm" variant="outline" onClick={() => onOpen('reject')}>{t(`${P}.actions.reject`)}</Button>}
        {ownsVersion && draft.kind === 'version' && <Button type="button" size="sm" variant="outline" onClick={() => onEdit(draft)}>{t(`${P}.actions.edit`)}</Button>}
        {ownsVersion && isStaleDraft(draft, state.latestVersionNo) && (
          <Button type="button" size="sm" variant="outline" disabled={rebasing} onClick={onRebase}>
            {t(`${P}.actions.rebase`, { latest: state.latestVersionNo })}
          </Button>
        )}
        {mine && <Button type="button" size="sm" variant="ghost" onClick={() => onOpen('withdraw')}>{t(`${P}.actions.withdraw`)}</Button>}
      </div>
      {mine && !caps.can_self_approve && caps.can_approve && <p className="text-xs text-muted-foreground">{t(`${P}.actions.selfApprovalOff`)}</p>}
    </>
  )
}

/** نافذة الاعتماد: لقطة مجمّدة بالمراجعة المعروضة، وتنبيه بنسخة أحدث، والفحص، وزر يرسل مراجعة اللقطة نفسها (§6). */
function ApproveReview({ snapshot, state, workCenters, busy, onApprove, onClose }: {
  readonly snapshot: CostPolicyDraft205
  readonly state: CostPolicy205State
  readonly workCenters: readonly CostPolicyWorkCenter[]
  readonly busy: boolean
  readonly onApprove: (revision: number) => void
  readonly onClose: () => void
}) {
  const { t } = useTranslation()
  const live = state.drafts.find(d => d.id === snapshot.id)
  const newer = live === undefined || live.revision !== snapshot.revision || live.status !== 'draft'
  const stale = isStaleDraft(snapshot, state.latestVersionNo)
  return (
    <div className="space-y-2 rounded-md border-2 p-3" role="region" aria-label={t(`${P}.approve.aria`)} data-testid={`cp205-approve-${snapshot.id}`}>
      <p className="font-medium">{t(`${P}.approve.title`, { revision: snapshot.revision })}</p>
      <DraftSummary draft={snapshot} workCenters={workCenters} />
      {snapshot.unallocated_budgets.length > 0 && (
        <p className="text-xs">{t(`${P}.approve.unallocated.${state.settings.unallocatedBudgetPolicy}`)}</p>
      )}
      {newer && <p className="text-destructive" role="alert">{t(`${P}.approve.newer`)}</p>}
      {stale && <p className="text-destructive" role="note">{t(`${P}.approve.staleDisabled`)}</p>}
      <DraftCheck draft={snapshot} revision={snapshot.revision} state={state} workCenters={workCenters} />
      <p className="text-xs text-muted-foreground">{t(`${P}.approve.serverRechecks`)}</p>
      <div className="flex gap-2">
        <Button type="button" disabled={busy || stale || newer} onClick={() => onApprove(snapshot.revision)}>
          {t(`${P}.approve.confirm`, { revision: snapshot.revision })}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>{t('manufacturingSettings.cancel')}</Button>
      </div>
    </div>
  )
}

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
  const close = () => { setOpen(null); setSnapshot(null) }
  const { approve, reject, withdraw, rebase } = useDraftDecisions(draft, state, close)
  const openAction = (next: Exclude<Open, null>) => {
    setSnapshot(next === 'approve' ? draft : null)
    setOpen(next)
  }
  return (
    <div className="space-y-2" data-testid={`cp205-actions-${draft.id}`}>
      <DraftActionButtons draft={draft} state={state} onOpen={openAction} onEdit={onEdit}
        onRebase={() => rebase.mutate(state.latestVersionNo)} rebasing={rebase.isPending} />
      {open === 'reject' && (
        <ReasonForm label={t(`${P}.actions.rejectReason`)} confirm={t(`${P}.actions.confirmReject`)} busy={reject.isPending}
          onConfirm={(r) => reject.mutate(r)} onCancel={close} testId={`cp205-reject-${draft.id}`} />
      )}
      {open === 'withdraw' && (
        <ReasonForm label={t(`${P}.actions.withdrawReason`)} confirm={t(`${P}.actions.confirmWithdraw`)} busy={withdraw.isPending}
          onConfirm={(r) => withdraw.mutate(r)} onCancel={close} testId={`cp205-withdraw-${draft.id}`} />
      )}
      {open === 'approve' && snapshot && (
        <ApproveReview snapshot={snapshot} state={state} workCenters={workCenters} busy={approve.isPending}
          onApprove={(revision) => approve.mutate({ revision })} onClose={close} />
      )}
    </div>
  )
}
