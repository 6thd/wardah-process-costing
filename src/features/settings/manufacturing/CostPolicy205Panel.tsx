import { useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatServerAmount,
  isStaleDraft,
  unresolvedLegacyVersions,
  type CostPolicy205State,
  type CostPolicyDraft205,
  type CostPolicyVersion205,
  type Policy205Status,
} from '@/services/mfg-cost-policy-205-service'
import {
  createLegacyResolutionDraft205,
  createVersionDraft205,
  listBudgetGlAccounts205,
  updateVersionDraft205,
  type DraftWriteResult,
  type LegacyResolutionPayload205,
  type VersionDraftPayload205,
} from '@/services/mfg-cost-policy-205-write-service'
import { listCostPolicyWorkCenters, type CostPolicyVersion, type CostPolicyWorkCenter } from '@/services/mfg-cost-policy-service'
import { PendingDraftActions } from './CostPolicy205Decisions'
import { CostPolicy205DraftForm } from './CostPolicy205DraftForm'
import { CostPolicy205LegacyForm } from './CostPolicy205LegacyForm'
import { CostPolicy205Preview } from './CostPolicy205Preview'
import { CostPolicy205SettingsActions, VersionWithdraw } from './CostPolicy205Settings'
import { formFromLatestVersion, formFromVersionPayload, keyForContent, type KeyedContent, type VersionDraftForm } from './costPolicy205Draft'
import { COST_POLICY_ADMIN_FREEZE_ACTIVE } from './costPolicyFreeze'
import { costPolicy205GlAccountsQueryKey, costPolicyWorkCentersQueryKey } from './queryKeys'
import { useCostPolicy205Action } from './useCostPolicy205Action'

const STATUS_VARIANT: Record<CostPolicyVersion['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  current: 'default',
  scheduled: 'outline',
  superseded: 'secondary',
  withdrawn: 'destructive',
}

const PATH_VARIANT: Record<Policy205Status, 'default' | 'secondary' | 'destructive'> = {
  approved_205: 'default',
  legacy_resolved: 'secondary',
  legacy_unresolved: 'destructive',
}

const P = 'manufacturingSettings.costPolicy205'
const C = 'manufacturingSettings.costPolicy'

type Editor =
  | { mode: 'create'; initial: VersionDraftForm }
  | { mode: 'edit'; draftId: string; initial: VersionDraftForm }

/**
 * لوحة 205 (UI-1 للقراءة، وUI-2 للكتابة): شريط الحالة وإعدادات الاعتماد، والمسودات المعلقة
 * بقراراتها، والإصدارات بمسارها وسحبها، والقديم غير المعالج ومعالجته، وسجل القرارات، والمعاينة
 * (التصميم §3). كل زر من `capabilities` للعرض فقط، والخادم هو الحكم. لا تستدعي معاينة 204 (§10)،
 * ولا تعرض مسار الإنشاء القديم. كل مبلغ من رد الخادم كما هو (§11). كل كتابة لمؤسسة اللوحة.
 */
export function CostPolicy205Panel({ state }: { readonly state: CostPolicy205State }) {
  const { t } = useTranslation()
  const [editor, setEditor] = useState<Editor | null>(null)
  const [resolving, setResolving] = useState<CostPolicyVersion205 | null>(null)
  const createKey = useRef<KeyedContent | null>(null)
  const legacyKey = useRef<KeyedContent | null>(null)
  const workCenters = useQuery({
    queryKey: costPolicyWorkCentersQueryKey(state.orgId), queryFn: () => listCostPolicyWorkCenters(state.orgId),
  })
  const glAccounts = useQuery({
    queryKey: costPolicy205GlAccountsQueryKey(state.orgId), queryFn: () => listBudgetGlAccounts205(state.orgId),
    enabled: editor !== null || resolving !== null,
  })
  const centers: readonly CostPolicyWorkCenter[] = workCenters.data ?? []
  const accounts = glAccounts.data ?? []
  const save = useCostPolicy205Action(state.orgId, {
    run: (org, vars: { payload: VersionDraftPayload205; draftId: string | null; latest: number }): Promise<DraftWriteResult | { revision: number; unchanged: boolean }> => {
      if (vars.draftId) return updateVersionDraft205(org, vars.draftId, vars.payload, vars.latest)
      // One key per content sent: the same content after a lost reply replays the same draft (design §6).
      createKey.current = keyForContent(createKey.current, JSON.stringify([vars.payload, vars.latest]), () => globalThis.crypto.randomUUID())
      return createVersionDraft205(org, vars.payload, vars.latest, createKey.current.key)
    },
    success: (r) => {
      if (r && 'unchanged' in r) return t(r.unchanged ? `${P}.done.unchanged` : `${P}.done.draftSaved`)
      return t(r && 'replayed' in r && r.replayed ? `${P}.done.draftReplayed` : `${P}.done.draftCreated`)
    },
    onDone: () => { setEditor(null); createKey.current = null },
  })
  const saveLegacy = useCostPolicy205Action(state.orgId, {
    run: (org, vars: { versionId: string; payload: LegacyResolutionPayload205; reason: string }) => {
      legacyKey.current = keyForContent(legacyKey.current, JSON.stringify([vars.versionId, vars.payload, vars.reason]), () => globalThis.crypto.randomUUID())
      return createLegacyResolutionDraft205(org, vars.versionId, vars.payload, vars.reason, legacyKey.current.key)
    },
    success: (r) => t(r?.replayed ? `${P}.done.draftReplayed` : `${P}.done.draftCreated`),
    onDone: () => { setResolving(null); legacyKey.current = null },
  })
  const openEdit = (d: CostPolicyDraft205) => setEditor({ mode: 'edit', draftId: d.id, initial: formFromVersionPayload(d.payload, state) })
  const openCopy = (d: CostPolicyDraft205) => {
    const initial = formFromVersionPayload(d.payload, state)
    setEditor({ mode: 'create', initial: { ...initial, effective_from: initial.effective_from < state.today ? state.today : initial.effective_from } })
  }
  const who = (id: string | null) => (id === null ? '—' : id === state.sessionUserId ? t(`${P}.you`) : id.slice(0, 8))
  const amount = (value: unknown) => {
    const text = formatServerAmount(value)
    return text === null ? '—' : t(`${P}.riyal`, { amount: text })
  }
  const versionNo = (id: string | null) => state.versions.find(v => v.id === id)?.version_no
  const pending = state.drafts.filter(d => d.status === 'draft')
  const decided = state.drafts.filter(d => d.status !== 'draft')
  const legacy = unresolvedLegacyVersions(state)

  return (
    <div className="space-y-6" data-testid="cp205-panel">
      <Alert>
        <AlertDescription>{t(`${P}.serverNotice`)}</AlertDescription>
      </Alert>
      {COST_POLICY_ADMIN_FREEZE_ACTIVE && (
        <Alert data-testid="cp205-freeze">
          <AlertDescription>{t(`${P}.freezeNotice`)}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t(`${P}.companyPolicy`)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t(`${P}.selfApproval`)}</dt>
              <dd data-testid="cp205-self-approval">{t(state.settings.selfApprovalEnabled ? `${P}.on` : `${P}.off`)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t(`${P}.unallocatedPolicy`)}</dt>
              <dd data-testid="cp205-unallocated-policy">{t(`${P}.unallocatedPolicies.${state.settings.unallocatedBudgetPolicy}`)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">{t(`${P}.policyAppliesForward`)}</p>
          <CostPolicy205SettingsActions state={state} />
          {state.settingsAudit.length > 0 && (
            <table className="w-full text-sm" aria-label={t(`${P}.settingsAudit`)}>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="p-2 text-start">{t(`${P}.changedAt`)}</th>
                  <th className="p-2 text-start">{t(`${P}.setting`)}</th>
                  <th className="p-2 text-start">{t(`${P}.change`)}</th>
                  <th className="p-2 text-start">{t(`${P}.by`)}</th>
                  <th className="p-2 text-start">{t(`${P}.reason`)}</th>
                </tr>
              </thead>
              <tbody>
                {state.settingsAudit.map(a => (
                  <tr key={a.id} className="border-b">
                    <td className="p-2">{a.changed_at}</td>
                    <td className="p-2">{t(`${P}.settings.${a.setting}`)}</td>
                    <td className="p-2 font-mono text-xs">{a.old_value} → {a.new_value}</td>
                    <td className="p-2">{who(a.changed_by)}</td>
                    <td className="p-2">{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>{t(`${P}.pendingDrafts`)}</CardTitle>
          {state.capabilities.can_create && editor === null && (
            <Button type="button" size="sm" onClick={() => setEditor({ mode: 'create', initial: formFromLatestVersion(state) })}>
              {t(`${P}.actions.newDraft`)}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {editor && (
            <CostPolicy205DraftForm key={editor.mode === 'edit' ? editor.draftId : 'new'} state={state} initial={editor.initial}
              mode={editor.mode} workCenters={centers} glAccounts={accounts} glAccountsStatus={glAccounts.status} saving={save.isPending}
              onSubmit={(payload) => save.mutate({ payload, draftId: editor.mode === 'edit' ? editor.draftId : null, latest: state.latestVersionNo })}
              onCancel={() => { setEditor(null); createKey.current = null }} />
          )}
          {pending.length === 0 ? (
            <p role="status">{t(`${P}.noPendingDrafts`)}</p>
          ) : pending.map(d => (
            <DraftCard key={d.id} draft={d} state={state} who={who} amount={amount} versionNo={versionNo}>
              <PendingDraftActions draft={d} state={state} workCenters={centers} onEdit={openEdit} />
            </DraftCard>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(`${P}.versions`)}</CardTitle>
          <p className="text-sm text-muted-foreground">{t(`${P}.budgetScope`)}</p>
        </CardHeader>
        <CardContent>
          {state.versions.length === 0 ? (
            <p role="status">{t(`${C}.empty`)}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">{t(`${C}.effectiveFrom`)}</th>
                    <th className="p-2 text-start">{t('manufacturingSettings.gl.status')}</th>
                    <th className="p-2 text-start">{t(`${P}.path`)}</th>
                    <th className="p-2 text-start">{t(`${C}.laborSource`)}</th>
                    <th className="p-2 text-start">{t(`${C}.pools`)}</th>
                    <th className="p-2 text-start">{t(`${P}.budgets`)}</th>
                    <th className="p-2 text-start">{t(`${C}.pinnedOrders`)}</th>
                    <th className="p-2 text-start">{t(`${P}.approval`)}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.versions.map(v => (
                    <VersionRow key={v.id} version={v} who={who} amount={amount}>
                      <VersionWithdraw state={state} version={v} />
                    </VersionRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {legacy.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t(`${P}.legacyTitle`)}</CardTitle>
            <p className="text-sm text-muted-foreground">{t(`${P}.legacyDescription`)}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {resolving && (
              <CostPolicy205LegacyForm key={resolving.id} state={state} version={resolving} glAccounts={accounts} glAccountsStatus={glAccounts.status} saving={saveLegacy.isPending}
                onSubmit={(payload, reason) => saveLegacy.mutate({ versionId: resolving.id, payload, reason })}
                onCancel={() => { setResolving(null); legacyKey.current = null }} />
            )}
            {legacy.map(v => {
              const pendingResolution = state.drafts.some(d => d.kind === 'legacy_resolution' && d.status === 'draft' && d.legacy_version_id === v.id)
              return (
                <div key={v.id} className="rounded-md border p-3 text-sm" data-testid={`cp205-legacy-${v.version_no}`}>
                  <p className="font-medium">
                    #{v.version_no} · {v.effective_from} · {t(`${C}.status.${v.status}`)}
                  </p>
                  <p>{t(`${P}.linkedOrders`, { pinned: v.pinned_order_count, awaiting: v.awaiting_start_order_count })}</p>
                  <p className="text-destructive">{t(`${P}.legacyRefused`)}</p>
                  {v.id === state.currentVersionId && <p className="text-destructive">{t(`${P}.legacyCurrent`)}</p>}
                  {pendingResolution && <p className="text-muted-foreground">{t(`${P}.legacyResolutionPending`)}</p>}
                  {state.capabilities.can_create && !pendingResolution && resolving === null && (
                    <Button type="button" size="sm" variant="outline" onClick={() => setResolving(v)}>{t(`${P}.actions.startResolution`)}</Button>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t(`${P}.history`)}</CardTitle>
        </CardHeader>
        <CardContent>
          {decided.length === 0 ? (
            <p role="status">{t(`${P}.noHistory`)}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="p-2 text-start">{t(`${P}.kind`)}</th>
                  <th className="p-2 text-start">{t(`${P}.decision`)}</th>
                  <th className="p-2 text-start">{t(`${P}.revision`)}</th>
                  <th className="p-2 text-start">{t(`${P}.by`)}</th>
                  <th className="p-2 text-start">{t(`${P}.decidedAt`)}</th>
                  <th className="p-2 text-start">{t(`${P}.reason`)}</th>
                  <th className="p-2 text-start"><span className="sr-only">{t(`${P}.actions.copy`)}</span></th>
                </tr>
              </thead>
              <tbody>
                {decided.map(d => (
                  <tr key={d.id} className="border-b" data-testid={`cp205-history-${d.id}`}>
                    <td className="p-2">{t(`${P}.kinds.${d.kind}`)}</td>
                    <td className="p-2">
                      {t(`${P}.draftStatus.${d.status}`)}
                      {d.result_version_id && versionNo(d.result_version_id) !== undefined && ` · #${versionNo(d.result_version_id)}`}
                    </td>
                    <td className="p-2">{d.revision}</td>
                    <td className="p-2">{who(d.decided_by)}</td>
                    <td className="p-2">{d.decided_at ?? '—'}</td>
                    <td className="p-2">{d.decision_reason ?? '—'}</td>
                    <td className="p-2">
                      {state.capabilities.can_create && d.kind === 'version' && (d.status === 'rejected' || d.status === 'withdrawn') && editor === null && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => openCopy(d)}>{t(`${P}.actions.copy`)}</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <CostPolicy205Preview state={state} workCenters={centers} />
    </div>
  )
}

function DraftCard({ draft, state, who, amount, versionNo, children }: {
  readonly draft: CostPolicyDraft205
  readonly state: CostPolicy205State
  readonly who: (id: string | null) => string
  readonly amount: (value: unknown) => string
  readonly versionNo: (id: string | null) => number | undefined
  readonly children?: ReactNode
}) {
  const { t } = useTranslation()
  const effective = typeof draft.payload.effective_from === 'string' ? draft.payload.effective_from : null
  return (
    <div className="space-y-1 rounded-md border p-3 text-sm" data-testid={`cp205-draft-${draft.id}`}>
      <p className="font-medium">
        {t(`${P}.kinds.${draft.kind}`)}
        {draft.kind === 'version' && effective && ` · ${t(`${C}.effectiveFrom`)} ${effective}`}
        {draft.kind === 'legacy_resolution' && ` · #${versionNo(draft.legacy_version_id) ?? '—'}`}
      </p>
      <p>{t(`${P}.draftMeta`, { revision: draft.revision, by: who(draft.created_by), at: draft.created_at })}</p>
      {draft.reason && <p>{t(`${P}.reason`)}: {draft.reason}</p>}
      {isStaleDraft(draft, state.latestVersionNo) && (
        <p className="text-destructive" role="note">{t(`${P}.staleDraft`, { saved: draft.expected_latest_version_no, latest: state.latestVersionNo })}</p>
      )}
      {draft.unallocated_budgets.length > 0 && (
        <div className="rounded-md bg-muted/50 p-2" data-testid={`cp205-draft-unallocated-${draft.id}`}>
          <p className="font-medium">{t(`${P}.unallocatedTitle`)}</p>
          <p className="text-xs text-muted-foreground">{t(`${P}.unallocatedAsEntered`)}</p>
          {draft.unallocated_budgets.map(b => (
            <p key={b.budget_code}><span className="font-mono">{b.budget_code}</span>: {amount(b.amount)}</p>
          ))}
          {state.settings.unallocatedBudgetPolicy === 'block' && <p className="text-destructive">{t(`${P}.unallocatedBlocked`)}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

function VersionRow({ version: v, who, amount, children }: {
  readonly version: CostPolicyVersion205
  readonly who: (id: string | null) => string
  readonly amount: (value: unknown) => string
  readonly children?: ReactNode
}) {
  const { t } = useTranslation()
  const activity = new Map((v.data_205?.pools ?? []).map(p => [p.code, p.activity]))
  const exception = v.unallocated_exception
  return (
    <tr className="border-b align-top" data-testid={`cp205-version-${v.version_no}`}>
      <td className="p-2">{v.version_no}</td>
      <td className="p-2">{v.effective_from}</td>
      <td className="p-2">
        <Badge variant={STATUS_VARIANT[v.status]}>{t(`${C}.status.${v.status}`)}</Badge>
        {v.withdraw_reason && <p className="text-xs text-muted-foreground">{v.withdraw_reason}</p>}
        {children}
      </td>
      <td className="p-2"><Badge variant={PATH_VARIANT[v.policy_205]}>{t(`${P}.paths.${v.policy_205}`)}</Badge></td>
      <td className="p-2">
        {t(`${C}.laborSources.${v.labor_cost_source}`)}
        {v.default_labor_rate_per_hour !== null && (
          <span className="block text-xs">{t(`${C}.perHour`, { rate: v.default_labor_rate_per_hour })}</span>
        )}
      </td>
      <td className="p-2">
        {v.overhead_pools.map(p => (
          <span key={p.pool_code} className="block text-xs">
            <span className="font-mono">{p.pool_code}</span>
            {' · '}{t(`${C}.bases.${p.basis}`)}
            {' · '}{t(`${C}.perHour`, { rate: p.rate })}
            {activity.get(p.pool_code) && <>{' · '}{t(`${P}.activities.${activity.get(p.pool_code)}`)}</>}
          </span>
        ))}
      </td>
      <td className="p-2">
        {(v.data_205?.budgets ?? []).map(b => (
          <span key={b.code} className="block text-xs"><span className="font-mono">{b.code}</span>: {amount(b.amount)}</span>
        ))}
        {exception && (
          <div className="mt-1 rounded-md bg-muted/50 p-1 text-xs" data-testid={`cp205-exception-${v.version_no}`}>
            <p className="font-medium">{t(`${P}.unallocatedTitle`)}</p>
            {Object.entries(exception.budgets).map(([code, value]) => (
              <p key={code}><span className="font-mono">{code}</span>: {amount(value)}</p>
            ))}
            <p>{t(`${P}.reason`)}: {exception.reason}</p>
            <p>{t(`${P}.treatment`)}: {exception.treatment}</p>
          </div>
        )}
      </td>
      <td className="p-2">
        {v.pinned_order_count}
        {v.awaiting_start_order_count > 0 && (
          <span className="block text-xs text-muted-foreground">{t(`${C}.awaitingStart`, { count: v.awaiting_start_order_count })}</span>
        )}
      </td>
      <td className="p-2 text-xs">
        {v.approval && (
          <>
            <span className="block">{t(`${P}.approvedBy`, { by: who(v.approval.approved_by), at: v.approval.approved_at })}</span>
            <span className="block">{t(`${P}.approvedRevision`, { revision: v.approval.draft_revision })}</span>
            {v.approval.self_approved && <span className="block">{t(`${P}.selfApproved`)}</span>}
          </>
        )}
        {v.legacy_resolution && (
          <span className="block">{t(`${P}.resolvedBy`, { by: who(v.legacy_resolution.approved_by), at: v.legacy_resolution.resolved_at })}</span>
        )}
      </td>
    </tr>
  )
}
