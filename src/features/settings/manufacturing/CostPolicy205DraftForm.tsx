import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CostPolicy205State } from '@/services/mfg-cost-policy-205-service'
import type { GlAccountOption205, VersionDraftPayload205 } from '@/services/mfg-cost-policy-205-write-service'
import type { CostPolicyWorkCenter, LaborCostSource, OverheadBasis, PinEvent } from '@/services/mfg-cost-policy-service'
import { CostPolicy205Allocation, SELECT_205 } from './CostPolicy205Allocation'
import {
  buildVersionPayload,
  code,
  hasInvalidNumber,
  MAX_POOLS,
  type AllocationForm,
  type PoolMode,
  type RuleForm,
  type VersionDraftForm,
  type VersionPoolForm,
} from './costPolicy205Draft'

const P = 'manufacturingSettings.costPolicy205'
const C = 'manufacturingSettings.costPolicy'

interface DraftFormProps {
  readonly state: CostPolicy205State
  readonly initial: VersionDraftForm
  readonly workCenters: readonly CostPolicyWorkCenter[]
  readonly glAccounts: readonly GlAccountOption205[]
  readonly saving: boolean
  readonly mode: 'create' | 'edit'
  readonly onSubmit: (payload: VersionDraftPayload205) => void
  readonly onCancel: () => void
}

/**
 * مسودة إصدار 205 (التصميم §7): حقول 204، ثم نشاط المجمعات وموازناتها والإقرارات والاستثناء.
 * الحفظ ينشئ مسودة أو يعدّلها ولا يكتب إصدارًا؛ الإصدار يُكتب بالاعتماد وحده.
 */
export function CostPolicy205DraftForm(props: DraftFormProps) {
  const { t } = useTranslation()
  const { state } = props
  const [form, setForm] = useState<VersionDraftForm>(props.initial)
  const [invalid, setInvalid] = useState(false)
  const patch = (p: Partial<VersionDraftForm>) => { setInvalid(false); setForm(f => ({ ...f, ...p })) }
  const setPool = (index: number, p: Partial<VersionPoolForm>) => patch({ pools: form.pools.map((x, i) => (i === index ? { ...x, ...p } : x)) })
  const allocation: AllocationForm = { budgets: form.budgets, acks: form.acks, exception: form.exception }

  const submit = () => {
    const payload = buildVersionPayload(form, state.settings.unallocatedBudgetPolicy)
    if (hasInvalidNumber(payload)) { setInvalid(true); return }
    props.onSubmit(payload)
  }

  return (
    <form className="space-y-5 rounded-md border p-4" aria-label={t(`${P}.form.aria.${props.mode}`)}
      onSubmit={(e) => { e.preventDefault(); submit() }}>
      <HeaderFields form={form} state={state} patch={patch} />
      <PoolDefinitions form={form} state={state} setPool={setPool} patch={patch} />
      {form.plannedHoursUnknown.length > 0 && (
        <p className="text-xs text-amber-700" role="note" data-testid="cp205-planned-hours-unknown">
          {t(`${P}.form.plannedHoursUnknown`, { budgets: form.plannedHoursUnknown.join(', ') })}
        </p>
      )}
      <CostPolicy205Allocation pools={form.pools} onPool={setPool} form={allocation}
        onChange={(a) => patch(a)} activities={state.supported.poolActivities} glAccounts={props.glAccounts}
        policy={state.settings.unallocatedBudgetPolicy} />
      <RuleRows form={form} workCenters={props.workCenters} patch={patch} />
      <div className="space-y-1">
        <Label htmlFor="cp205-note">{t(`${C}.form.note`)}</Label>
        <Input id="cp205-note" maxLength={500} value={form.note} onChange={(e) => patch({ note: e.target.value })} />
      </div>
      {invalid && <p className="text-destructive" role="alert">{t(`${P}.form.invalidNumber`)}</p>}
      <p className="text-xs text-muted-foreground">{t(`${P}.form.saveIsNotApproval`)}</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={props.saving}>{t(`${P}.form.submit.${props.mode}`)}</Button>
        <Button type="button" variant="ghost" onClick={props.onCancel}>{t('manufacturingSettings.cancel')}</Button>
      </div>
    </form>
  )
}

interface PartProps {
  readonly form: VersionDraftForm
  readonly state: CostPolicy205State
  readonly patch: (p: Partial<VersionDraftForm>) => void
}

function HeaderFields({ form, state, patch }: PartProps) {
  const { t } = useTranslation()
  const usesRates = form.labor_cost_source === 'work_center_rate'
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor="cp205-effective">{t(`${C}.form.effectiveFrom`)}</Label>
        <Input id="cp205-effective" type="date" min={state.today} value={form.effective_from} required
          onChange={(e) => patch({ effective_from: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cp205-labor-source">{t(`${C}.laborSource`)}</Label>
        <select id="cp205-labor-source" className={SELECT_205} value={form.labor_cost_source}
          onChange={(e) => patch({ labor_cost_source: e.target.value as LaborCostSource })}>
          {state.supported.laborCostSources.map(s => <option key={s} value={s}>{t(`${C}.laborSources.${s}`)}</option>)}
        </select>
      </div>
      {usesRates && (
        <div className="space-y-1">
          <Label htmlFor="cp205-default-labor">{t(`${C}.defaultLaborRate`)}</Label>
          <Input id="cp205-default-labor" inputMode="decimal" value={form.default_labor_rate} required
            onChange={(e) => patch({ default_labor_rate: e.target.value })} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="cp205-pin-event">{t(`${C}.pinEvent`)}</Label>
        <select id="cp205-pin-event" className={SELECT_205} value={form.pin_event}
          onChange={(e) => patch({ pin_event: e.target.value as PinEvent })}>
          {state.supported.pinEvents.map(ev => <option key={ev} value={ev}>{t(`${C}.pinEvents.${ev}`)}</option>)}
        </select>
      </div>
    </div>
  )
}

function PoolDefinitions({ form, state, setPool, patch }: PartProps & { readonly setPool: (i: number, p: Partial<VersionPoolForm>) => void }) {
  const { t } = useTranslation()
  const blank: VersionPoolForm = { pool_code: '', name: '', name_ar: '', basis: state.supported.overheadBases[0] ?? 'labor_hours', rate: '', activity: '', budgets: [] }
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t(`${C}.pools`)}</legend>
      {form.pools.map((pool, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-6" data-testid="cp205-pool-row">
          <Input aria-label={t(`${C}.form.poolCode`)} value={pool.pool_code} required onChange={(e) => setPool(index, { pool_code: e.target.value })} />
          <Input aria-label={t(`${C}.form.poolName`)} value={pool.name} required onChange={(e) => setPool(index, { name: e.target.value })} />
          <Input aria-label={t(`${C}.form.poolNameAr`)} value={pool.name_ar} onChange={(e) => setPool(index, { name_ar: e.target.value })} />
          <select aria-label={t(`${C}.form.basis`)} className={SELECT_205} value={pool.basis}
            onChange={(e) => setPool(index, { basis: e.target.value as OverheadBasis })}>
            {state.supported.overheadBases.map(b => <option key={b} value={b}>{t(`${C}.bases.${b}`)}</option>)}
          </select>
          <Input aria-label={t(`${C}.form.poolRate`)} inputMode="decimal" value={pool.rate} required
            onChange={(e) => setPool(index, { rate: e.target.value })} />
          <Button type="button" variant="ghost" disabled={form.pools.length === 1}
            onClick={() => patch({ pools: form.pools.filter((_, i) => i !== index) })}>
            {t(`${C}.form.remove`)}
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={form.pools.length >= MAX_POOLS}
        onClick={() => patch({ pools: [...form.pools, blank] })}>
        {t(`${C}.form.addPool`)}
      </Button>
    </fieldset>
  )
}

function RuleRows({ form, workCenters, patch }: Omit<PartProps, 'state'> & { readonly workCenters: readonly CostPolicyWorkCenter[] }) {
  const { t, i18n } = useTranslation()
  const ar = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const usesRates = form.labor_cost_source === 'work_center_rate'
  const poolCodes = form.pools.map(p => code(p.pool_code)).filter(Boolean)
  const setRule = (index: number, r: Partial<RuleForm>) => patch({ rules: form.rules.map((x, i) => (i === index ? { ...x, ...r } : x)) })
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">{t(`${C}.workCenterRules`)}</legend>
      <p className="text-xs text-muted-foreground">{t(`${C}.form.rulesHelp`)}</p>
      {form.rules.map((rule, index) => (
        <div key={index} className="space-y-2 rounded border p-3" data-testid="cp205-rule-row">
          <div className="grid gap-2 md:grid-cols-3">
            <select aria-label={t(`${C}.form.workCenter`)} className={SELECT_205} value={rule.work_center_id} required
              onChange={(e) => setRule(index, { work_center_id: e.target.value })}>
              <option value="">{t('manufacturingSettings.gl.choose')}</option>
              {workCenters.map(wc => <option key={wc.id} value={wc.id}>{wc.code} — {ar && wc.nameAr ? wc.nameAr : wc.name}</option>)}
            </select>
            {usesRates && (
              <Input aria-label={t(`${C}.form.wcLaborRate`)} inputMode="decimal" placeholder={t(`${C}.form.usesDefault`)}
                value={rule.labor_rate} onChange={(e) => setRule(index, { labor_rate: e.target.value })} />
            )}
            <Button type="button" variant="ghost" onClick={() => patch({ rules: form.rules.filter((_, i) => i !== index) })}>
              {t(`${C}.form.remove`)}
            </Button>
          </div>
          {poolCodes.map(pc => {
            const current = rule.pools[pc] ?? { mode: 'default' as PoolMode, rate: '' }
            const setMode = (next: { mode: PoolMode; rate: string }) => setRule(index, { pools: { ...rule.pools, [pc]: next } })
            return (
              <div key={pc} className="grid gap-2 md:grid-cols-3">
                <span className="self-center font-mono text-xs">{pc}</span>
                <select aria-label={t(`${C}.form.poolMode`, { pool: pc })} className={SELECT_205} value={current.mode}
                  onChange={(e) => setMode({ ...current, mode: e.target.value as PoolMode })}>
                  {(['default', 'override', 'exclude'] as const).map(m => <option key={m} value={m}>{t(`${C}.form.modes.${m}`)}</option>)}
                </select>
                {current.mode === 'override' && (
                  <Input aria-label={t(`${C}.form.overrideRate`, { pool: pc })} inputMode="decimal" value={current.rate} required
                    onChange={(e) => setMode({ ...current, rate: e.target.value })} />
                )}
              </div>
            )
          })}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm"
        onClick={() => patch({ rules: [...form.rules, { work_center_id: '', labor_rate: '', pools: {} }] })}>
        {t(`${C}.form.addRule`)}
      </Button>
    </fieldset>
  )
}
