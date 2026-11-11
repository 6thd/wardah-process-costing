import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import type { CostPolicyVersion } from '@/services/mfg-cost-policy-service'
import { COST_POLICY_ADMIN_FREEZE_ACTIVE } from './costPolicyFreeze'

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

/**
 * لوحة 205 للقراءة فقط (UI-1): شريط الحالة، والمسودات المعلقة، والإصدارات بمسارها، والقديم
 * غير المعالج، وسجل القرارات، وإعدادات الاعتماد وسجلها (التصميم §3). لا زر كتابة فيها مهما
 * كانت `capabilities`: الإنشاء والاعتماد والرفض والإعدادات والمعالجة والسحب في UI-2. ولا
 * تستدعي معاينة 204 (§10)، ولا تعرض مسار الإنشاء القديم. كل مبلغ من رد الخادم كما هو (§11).
 */
export function CostPolicy205Panel({ state }: { readonly state: CostPolicy205State }) {
  const { t } = useTranslation()
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
        <AlertDescription>{t(`${P}.readOnlyNotice`)}</AlertDescription>
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
        <CardHeader>
          <CardTitle>{t(`${P}.pendingDrafts`)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.length === 0 ? (
            <p role="status">{t(`${P}.noPendingDrafts`)}</p>
          ) : pending.map(d => (
            <DraftCard key={d.id} draft={d} state={state} who={who} amount={amount} versionNo={versionNo} />
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
                    <VersionRow key={v.id} version={v} who={who} amount={amount} />
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
            {legacy.map(v => {
              const resolving = state.drafts.some(d => d.kind === 'legacy_resolution' && d.status === 'draft' && d.legacy_version_id === v.id)
              return (
                <div key={v.id} className="rounded-md border p-3 text-sm" data-testid={`cp205-legacy-${v.version_no}`}>
                  <p className="font-medium">
                    #{v.version_no} · {v.effective_from} · {t(`${C}.status.${v.status}`)}
                  </p>
                  <p>{t(`${P}.linkedOrders`, { pinned: v.pinned_order_count, awaiting: v.awaiting_start_order_count })}</p>
                  <p className="text-destructive">{t(`${P}.legacyRefused`)}</p>
                  {v.id === state.currentVersionId && <p className="text-destructive">{t(`${P}.legacyCurrent`)}</p>}
                  {resolving && <p className="text-muted-foreground">{t(`${P}.legacyResolutionPending`)}</p>}
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DraftCard({ draft, state, who, amount, versionNo }: {
  readonly draft: CostPolicyDraft205
  readonly state: CostPolicy205State
  readonly who: (id: string | null) => string
  readonly amount: (value: unknown) => string
  readonly versionNo: (id: string | null) => number | undefined
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
    </div>
  )
}

function VersionRow({ version: v, who, amount }: {
  readonly version: CostPolicyVersion205
  readonly who: (id: string | null) => string
  readonly amount: (value: unknown) => string
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
