import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  CostPolicyDraft,
  CostPolicyState,
  CostPolicyVersion,
  CostPolicyWorkCenter,
  LaborCostSource,
  OverheadBasis,
  PinEvent,
} from '@/services/mfg-cost-policy-service'

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'

interface PoolRow { pool_code: string; name: string; name_ar: string; basis: OverheadBasis; rate: string }
type PoolMode = 'default' | 'override' | 'exclude'
interface RuleRow { work_center_id: string; labor_rate: string; pools: Record<string, { mode: PoolMode; rate: string }> }

/** نموذج إصدار جديد، مملوء مسبقًا من آخر إصدار حي. لا يعرض إلا القيم المنفذة (`supported`). */
export function CostPolicyVersionForm({
  state, base, workCenters, saving, onSubmit, onCancel,
}: {
  readonly state: CostPolicyState
  readonly base: CostPolicyVersion | undefined
  readonly workCenters: readonly CostPolicyWorkCenter[]
  readonly saving: boolean
  readonly onSubmit: (draft: CostPolicyDraft) => void
  readonly onCancel: () => void
}) {
  const { t, i18n } = useTranslation()
  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const [effectiveFrom, setEffectiveFrom] = useState(state.today)
  const [laborSource, setLaborSource] = useState<LaborCostSource>(
    base?.labor_cost_source ?? state.supported.labor_cost_sources[0])
  const [defaultLaborRate, setDefaultLaborRate] = useState(base?.default_labor_rate_per_hour?.toString() ?? '')
  const [pinEvent, setPinEvent] = useState<PinEvent>(base?.pin_event ?? state.supported.pin_events[0])
  const [note, setNote] = useState('')
  const [pools, setPools] = useState<PoolRow[]>(
    base?.overhead_pools.map(p => ({ pool_code: p.pool_code, name: p.name, name_ar: p.name_ar ?? '', basis: p.basis, rate: String(p.rate) }))
      ?? [{ pool_code: '', name: '', name_ar: '', basis: state.supported.overhead_bases[0], rate: '' }])
  const [rules, setRules] = useState<RuleRow[]>(
    base?.work_center_rules.map(r => ({
      work_center_id: r.work_center_id,
      labor_rate: r.labor_rate_per_hour?.toString() ?? '',
      pools: Object.fromEntries(r.pools.map(p => [p.pool_code, {
        mode: (p.applies ? 'override' : 'exclude') as PoolMode, rate: p.rate?.toString() ?? '' }])),
    })) ?? [])

  const usesRates = laborSource === 'work_center_rate'
  const wcLabel = (wc: CostPolicyWorkCenter) => `${wc.code} — ${isRTL && wc.nameAr ? wc.nameAr : wc.name}`

  const buildDraft = (): CostPolicyDraft => ({
    effective_from: effectiveFrom,
    labor_cost_source: laborSource,
    ...(usesRates ? { default_labor_rate_per_hour: Number(defaultLaborRate) } : {}),
    pin_event: pinEvent,
    ...(note.trim() ? { note: note.trim() } : {}),
    overhead_pools: pools.map(p => ({
      pool_code: p.pool_code.trim().toUpperCase(),
      name: p.name.trim(),
      ...(p.name_ar.trim() ? { name_ar: p.name_ar.trim() } : {}),
      basis: p.basis,
      rate: Number(p.rate),
    })),
    work_center_rules: rules
      .filter(r => r.work_center_id)
      .map(r => {
        const poolRules = Object.entries(r.pools)
          .filter(([code, rule]) => rule.mode !== 'default' && pools.some(p => p.pool_code.trim().toUpperCase() === code))
          .map(([code, rule]) => rule.mode === 'exclude'
            ? { pool_code: code, applies: false }
            : { pool_code: code, applies: true, rate: Number(rule.rate) })
        return {
          work_center_id: r.work_center_id,
          ...(usesRates && r.labor_rate.trim() ? { labor_rate_per_hour: Number(r.labor_rate) } : {}),
          ...(poolRules.length > 0 ? { pools: poolRules } : {}),
        }
      }),
  })

  const poolCodes = pools.map(p => p.pool_code.trim().toUpperCase()).filter(Boolean)

  return (
    <form
      className="space-y-5 rounded-md border p-4"
      aria-label={t('manufacturingSettings.costPolicy.form.aria')}
      onSubmit={(e) => { e.preventDefault(); onSubmit(buildDraft()) }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="cp-effective">{t('manufacturingSettings.costPolicy.form.effectiveFrom')}</Label>
          <Input id="cp-effective" type="date" min={state.today} value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-labor-source">{t('manufacturingSettings.costPolicy.laborSource')}</Label>
          <select id="cp-labor-source" className={SELECT_CLASS} value={laborSource}
            onChange={(e) => setLaborSource(e.target.value as LaborCostSource)}>
            {state.supported.labor_cost_sources.map(source => (
              <option key={source} value={source}>{t(`manufacturingSettings.costPolicy.laborSources.${source}`)}</option>
            ))}
          </select>
        </div>
        {usesRates && (
          <div className="space-y-1">
            <Label htmlFor="cp-default-labor">{t('manufacturingSettings.costPolicy.defaultLaborRate')}</Label>
            <Input id="cp-default-labor" type="number" min="0" step="0.000001" value={defaultLaborRate}
              onChange={(e) => setDefaultLaborRate(e.target.value)} required />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="cp-pin-event">{t('manufacturingSettings.costPolicy.pinEvent')}</Label>
          <select id="cp-pin-event" className={SELECT_CLASS} value={pinEvent}
            onChange={(e) => setPinEvent(e.target.value as PinEvent)}>
            {state.supported.pin_events.map(event => (
              <option key={event} value={event}>{t(`manufacturingSettings.costPolicy.pinEvents.${event}`)}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t('manufacturingSettings.costPolicy.form.pinEventHelp')}</p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium">{t('manufacturingSettings.costPolicy.pools')}</legend>
        {pools.map((pool, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-6" data-testid="cp-pool-row">
            <Input aria-label={t('manufacturingSettings.costPolicy.form.poolCode')} value={pool.pool_code} required
              onChange={(e) => setPools(pools.map((p, i) => i === index ? { ...p, pool_code: e.target.value } : p))} />
            <Input aria-label={t('manufacturingSettings.costPolicy.form.poolName')} value={pool.name} required
              onChange={(e) => setPools(pools.map((p, i) => i === index ? { ...p, name: e.target.value } : p))} />
            <Input aria-label={t('manufacturingSettings.costPolicy.form.poolNameAr')} value={pool.name_ar}
              onChange={(e) => setPools(pools.map((p, i) => i === index ? { ...p, name_ar: e.target.value } : p))} />
            <select aria-label={t('manufacturingSettings.costPolicy.form.basis')} className={SELECT_CLASS} value={pool.basis}
              onChange={(e) => setPools(pools.map((p, i) => i === index ? { ...p, basis: e.target.value as OverheadBasis } : p))}>
              {state.supported.overhead_bases.map(basis => (
                <option key={basis} value={basis}>{t(`manufacturingSettings.costPolicy.bases.${basis}`)}</option>
              ))}
            </select>
            <Input aria-label={t('manufacturingSettings.costPolicy.form.poolRate')} type="number" min="0" step="0.000001"
              value={pool.rate} required
              onChange={(e) => setPools(pools.map((p, i) => i === index ? { ...p, rate: e.target.value } : p))} />
            <Button type="button" variant="ghost" disabled={pools.length === 1}
              onClick={() => setPools(pools.filter((_, i) => i !== index))}>
              {t('manufacturingSettings.costPolicy.form.remove')}
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={pools.length >= 20}
          onClick={() => setPools([...pools, { pool_code: '', name: '', name_ar: '', basis: state.supported.overhead_bases[0], rate: '' }])}>
          {t('manufacturingSettings.costPolicy.form.addPool')}
        </Button>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-medium">{t('manufacturingSettings.costPolicy.workCenterRules')}</legend>
        <p className="text-xs text-muted-foreground">{t('manufacturingSettings.costPolicy.form.rulesHelp')}</p>
        {rules.map((rule, index) => (
          <div key={index} className="space-y-2 rounded border p-3" data-testid="cp-rule-row">
            <div className="grid gap-2 md:grid-cols-3">
              <select aria-label={t('manufacturingSettings.costPolicy.form.workCenter')} className={SELECT_CLASS}
                value={rule.work_center_id} required
                onChange={(e) => setRules(rules.map((r, i) => i === index ? { ...r, work_center_id: e.target.value } : r))}>
                <option value="">{t('manufacturingSettings.gl.choose')}</option>
                {workCenters.map(wc => <option key={wc.id} value={wc.id}>{wcLabel(wc)}</option>)}
              </select>
              {usesRates && (
                <Input aria-label={t('manufacturingSettings.costPolicy.form.wcLaborRate')} type="number" min="0" step="0.000001"
                  placeholder={t('manufacturingSettings.costPolicy.form.usesDefault')} value={rule.labor_rate}
                  onChange={(e) => setRules(rules.map((r, i) => i === index ? { ...r, labor_rate: e.target.value } : r))} />
              )}
              <Button type="button" variant="ghost" onClick={() => setRules(rules.filter((_, i) => i !== index))}>
                {t('manufacturingSettings.costPolicy.form.remove')}
              </Button>
            </div>
            {poolCodes.map(code => {
              const current = rule.pools[code] ?? { mode: 'default' as PoolMode, rate: '' }
              const setPool = (next: { mode: PoolMode; rate: string }) =>
                setRules(rules.map((r, i) => i === index ? { ...r, pools: { ...r.pools, [code]: next } } : r))
              return (
                <div key={code} className="grid gap-2 md:grid-cols-3">
                  <span className="self-center font-mono text-xs">{code}</span>
                  <select aria-label={t('manufacturingSettings.costPolicy.form.poolMode', { pool: code })} className={SELECT_CLASS}
                    value={current.mode} onChange={(e) => setPool({ ...current, mode: e.target.value as PoolMode })}>
                    <option value="default">{t('manufacturingSettings.costPolicy.form.modes.default')}</option>
                    <option value="override">{t('manufacturingSettings.costPolicy.form.modes.override')}</option>
                    <option value="exclude">{t('manufacturingSettings.costPolicy.form.modes.exclude')}</option>
                  </select>
                  {current.mode === 'override' && (
                    <Input aria-label={t('manufacturingSettings.costPolicy.form.overrideRate', { pool: code })} type="number"
                      min="0" step="0.000001" value={current.rate} required
                      onChange={(e) => setPool({ ...current, rate: e.target.value })} />
                  )}
                </div>
              )
            })}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm"
          onClick={() => setRules([...rules, { work_center_id: '', labor_rate: '', pools: {} }])}>
          {t('manufacturingSettings.costPolicy.form.addRule')}
        </Button>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="cp-note">{t('manufacturingSettings.costPolicy.form.note')}</Label>
        <Input id="cp-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{t('manufacturingSettings.costPolicy.form.submit')}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t('manufacturingSettings.cancel')}</Button>
      </div>
    </form>
  )
}
