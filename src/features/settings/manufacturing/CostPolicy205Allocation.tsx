import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PoolActivity, UnallocatedBudgetPolicy } from '@/services/mfg-cost-policy-205-service'
import type { GlAccountOption205 } from '@/services/mfg-cost-policy-205-write-service'
import {
  ackCandidates,
  ackKey,
  allocationWarnings,
  code,
  editBudget,
  emptyBudget,
  MAX_BUDGETS,
  removeBudget,
  unallocatedCodes,
  type AllocationForm,
  type AllocationPool,
  type BudgetForm,
  type BudgetRemap,
} from './costPolicy205Draft'

export const SELECT_205 =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'

const P = 'manufacturingSettings.costPolicy205'

interface AllocationProps {
  readonly pools: readonly AllocationPool[]
  readonly onPool: (index: number, patch: Partial<AllocationPool>) => void
  readonly form: AllocationForm
  /** `remap` غير فارغ حين تغيّر رمز موازنة أو حُذفت: صاحب المجمعات يطبقه على موازناتها (`remapPools`). */
  readonly onChange: (form: AllocationForm, remap: BudgetRemap | null) => void
  readonly activities: readonly PoolActivity[]
  readonly glAccounts: readonly GlAccountOption205[]
  /** حالة قراءة الحسابات: فشلها أو قائمة فارغة يُقال صراحة بدل خيار «بلا حساب» الصامت. */
  readonly glAccountsStatus: 'pending' | 'error' | 'success'
  readonly policy: UnallocatedBudgetPolicy
}

/**
 * الموازنات وتحميلها على المجمعات والإقرارات والاستثناء (التصميم §7 و§11 و§12). مشترك بين مسودة
 * الإصدار ومعالجة القديم. لا حقل مركز تكلفة: النطاق المتاح الحساب العام.
 */
export function CostPolicy205Allocation(props: AllocationProps) {
  const { t } = useTranslation()
  const warnings = allocationWarnings(props.pools, props.form, props.policy)
  return (
    <div className="space-y-4">
      <BudgetRows {...props} />
      <PoolAllocationRows {...props} />
      <AckRows {...props} />
      <UnallocatedSection {...props} />
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 p-2 text-xs" data-testid="cp205-warnings">
          <p className="font-medium">{t(`${P}.form.warningsTitle`)}</p>
          <ul className="list-disc ps-4">
            {warnings.map(w => (
              <li key={`${w.code}-${w.detail}`}>{t(`${P}.errors.${w.code}`)} ({w.detail})</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function BudgetRows({ form, onChange, glAccounts, glAccountsStatus }: AllocationProps) {
  const { t, i18n } = useTranslation()
  const ar = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const set = (index: number, patch: Partial<BudgetForm>) => {
    const next = editBudget(form, index, patch)
    onChange(next.form, next.remap)
  }
  const remove = (index: number) => {
    const next = removeBudget(form, index)
    onChange(next.form, next.remap)
  }
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t(`${P}.budgets`)}</legend>
      <p className="text-xs text-muted-foreground">{t(`${P}.budgetScope`)}</p>
      {glAccountsStatus === 'error' && (
        <p className="text-destructive text-sm" role="alert" data-testid="cp205-accounts-failed">{t(`${P}.form.accountsFailed`)}</p>
      )}
      {glAccountsStatus === 'success' && glAccounts.length === 0 && form.budgets.length > 0 && (
        <p className="text-amber-700 text-sm" role="note" data-testid="cp205-accounts-empty">{t(`${P}.form.accountsEmpty`)}</p>
      )}
      {form.budgets.map((b, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-6" data-testid="cp205-budget-row">
          <Input aria-label={t(`${P}.form.budgetCode`)} value={b.budget_code} required
            onChange={(e) => set(index, { budget_code: e.target.value })} />
          <select aria-label={t(`${P}.form.glAccount`)} className={SELECT_205} value={b.gl_account_id}
            onChange={(e) => set(index, { gl_account_id: e.target.value })}>
            <option value="">{t(`${P}.form.noAccount`)}</option>
            {glAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {ar && a.nameAr ? a.nameAr : a.name}</option>)}
          </select>
          <Input aria-label={t(`${P}.form.amount`)} inputMode="decimal" value={b.amount}
            onChange={(e) => set(index, { amount: e.target.value })} />
          <Input aria-label={t(`${P}.form.plannedHours`)} inputMode="decimal" value={b.planned_hours}
            onChange={(e) => set(index, { planned_hours: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={b.setup_related} onChange={(e) => set(index, { setup_related: e.target.checked })} />
            {t(`${P}.form.setupRelated`)}
          </label>
          <Button type="button" variant="ghost" onClick={() => remove(index)}>
            {t('manufacturingSettings.costPolicy.form.remove')}
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={form.budgets.length >= MAX_BUDGETS}
        onClick={() => onChange({ ...form, budgets: [...form.budgets, emptyBudget()] }, null)}>
        {t(`${P}.form.addBudget`)}
      </Button>
    </fieldset>
  )
}

function PoolAllocationRows({ pools, onPool, form, activities }: AllocationProps) {
  const { t } = useTranslation()
  const codes = form.budgets.map(b => code(b.budget_code)).filter(Boolean)
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t(`${P}.form.poolAllocation`)}</legend>
      {pools.map((pool, index) => {
        const pc = code(pool.pool_code) || `#${index + 1}`
        return (
          <div key={index} className="space-y-1 rounded border p-2" data-testid={`cp205-pool-allocation-${pc}`}>
            <div className="grid gap-2 md:grid-cols-3">
              <span className="self-center font-mono text-xs">{pc}</span>
              <select aria-label={t(`${P}.form.activityOf`, { pool: pc })} className={SELECT_205} value={pool.activity}
                onChange={(e) => onPool(index, { activity: e.target.value as AllocationPool['activity'] })}>
                <option value="">{t(`${P}.form.activityUnset`)}</option>
                {activities.map(a => <option key={a} value={a}>{t(`${P}.activities.${a}`)}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              {codes.map(bc => (
                <label key={bc} className="flex items-center gap-1">
                  <input type="checkbox" aria-label={t(`${P}.form.loads`, { pool: pc, budget: bc })} checked={pool.budgets.includes(bc)}
                    onChange={(e) => onPool(index, { budgets: e.target.checked ? [...pool.budgets, bc] : pool.budgets.filter(x => x !== bc) })} />
                  <span className="font-mono text-xs">{bc}</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </fieldset>
  )
}

function AckRows({ pools, form, onChange }: AllocationProps) {
  const { t } = useTranslation()
  const candidates = ackCandidates(pools, form.budgets)
  if (candidates.length === 0) return null
  const acked = new Set(form.acks)
  return (
    <fieldset className="space-y-1">
      <legend className="font-medium">{t(`${P}.form.setupAcks`)}</legend>
      <p className="text-xs text-muted-foreground">{t(`${P}.form.setupAcksHelp`)}</p>
      {candidates.map(c => {
        const key = ackKey(c.pool, c.budget)
        return (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={acked.has(key)}
              onChange={(e) => onChange({ ...form, acks: e.target.checked ? [...form.acks, key] : form.acks.filter(x => x !== key) }, null)} />
            {t(`${P}.form.ack`, { pool: c.pool, budget: c.budget })}
          </label>
        )
      })}
    </fieldset>
  )
}

function UnallocatedSection({ pools, form, onChange, policy }: AllocationProps) {
  const { t } = useTranslation()
  const codes = unallocatedCodes(pools, form.budgets)
  if (codes.length === 0) return null
  const amountOf = (c: string) => form.budgets.find(b => code(b.budget_code) === c)?.amount || '—'
  return (
    <div className="space-y-2 rounded-md bg-muted/50 p-3 text-sm" data-testid="cp205-form-unallocated">
      <p className="font-medium">{t(`${P}.unallocatedTitle`)}</p>
      <p className="text-xs text-muted-foreground">{t(`${P}.unallocatedAsEntered`)}</p>
      {codes.map(c => <p key={c}><span className="font-mono">{c}</span>: {amountOf(c)}</p>)}
      {policy === 'block' ? (
        <p className="text-destructive" role="note">{t(`${P}.form.unallocatedWillBeRefused`)}</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          <p className="md:col-span-2 text-xs">{t(`${P}.form.exceptionHelp`)}</p>
          <Input aria-label={t(`${P}.form.exceptionReason`)} maxLength={500} value={form.exception.reason} required
            onChange={(e) => onChange({ ...form, exception: { ...form.exception, reason: e.target.value } }, null)} />
          <Input aria-label={t(`${P}.form.exceptionTreatment`)} maxLength={500} value={form.exception.treatment} required
            onChange={(e) => onChange({ ...form, exception: { ...form.exception, treatment: e.target.value } }, null)} />
        </div>
      )}
    </div>
  )
}
