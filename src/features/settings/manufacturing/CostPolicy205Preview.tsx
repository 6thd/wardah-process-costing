import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatServerAmount, type CostPolicy205State } from '@/services/mfg-cost-policy-205-service'
import {
  previewAbsorption205,
  type Preview205,
  type PreviewInput205,
} from '@/services/mfg-cost-policy-205-write-service'
import type { CostPolicyWorkCenter } from '@/services/mfg-cost-policy-service'
import { SELECT_205 } from './CostPolicy205Allocation'
import { costPolicy205ErrorMessage } from './costPolicy205Error'
import { buildHours, decimalOrUndefined, emptyHours, type HoursText } from './costPolicy205Draft'

const P = 'manufacturingSettings.costPolicy205'

/** مبلغ من رد الخادم بالريال كما هو (§11). */
export function useRiyal() {
  const { t } = useTranslation()
  return (value: unknown) => {
    const text = formatServerAmount(value)
    return text === null ? '—' : t(`${P}.riyal`, { amount: text })
  }
}

/** مدخلات المعاينة كما كُتبت: المركز، والساعات الأربع، والتكلفة المسجلة. */
export interface PreviewInputsText { workCenterId: string; hours: HoursText; recorded: string }

export const emptyPreviewInputs = (): PreviewInputsText => ({ workCenterId: '', hours: emptyHours(), recorded: '' })

/** حقول المركز والساعات والتكلفة المسجلة. التكلفة المسجلة تظهر فقط لمصدر `recorded_entry_rate` (§10). */
export function PreviewInputs({ value, onChange, workCenters, recordedApplies, idPrefix }: {
  readonly value: PreviewInputsText
  readonly onChange: (v: PreviewInputsText) => void
  readonly workCenters: readonly CostPolicyWorkCenter[]
  readonly recordedApplies: boolean
  readonly idPrefix: string
}) {
  const { t } = useTranslation()
  const hour = (key: keyof HoursText) => (
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-${key}`}>{t(`${P}.preview.hours.${key}`)}</Label>
      <Input id={`${idPrefix}-${key}`} inputMode="decimal" value={value.hours[key]}
        onChange={(e) => onChange({ ...value, hours: { ...value.hours, [key]: e.target.value } })} />
    </div>
  )
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-wc`}>{t('manufacturingSettings.costPolicy.form.workCenter')}</Label>
        <select id={`${idPrefix}-wc`} className={SELECT_205} value={value.workCenterId}
          onChange={(e) => onChange({ ...value, workCenterId: e.target.value })}>
          <option value="">{t('manufacturingSettings.gl.choose')}</option>
          {workCenters.map(wc => <option key={wc.id} value={wc.id}>{wc.code} — {wc.name}</option>)}
        </select>
      </div>
      {hour('laborRun')}
      {hour('laborSetup')}
      {hour('machineRun')}
      {hour('machineSetup')}
      {recordedApplies && (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-recorded`}>{t('manufacturingSettings.costPolicy.preview.recordedCost')}</Label>
          <Input id={`${idPrefix}-recorded`} inputMode="decimal" value={value.recorded}
            onChange={(e) => onChange({ ...value, recorded: e.target.value })} />
        </div>
      )}
      <p className="md:col-span-3 text-xs text-muted-foreground">{t(`${P}.preview.hoursHelp`)}</p>
    </div>
  )
}

/** المدخلات المرسلة، أو `null` إن كان فيها نص لا يُقرأ رقمًا. */
export function parsePreviewInputs(v: PreviewInputsText, recordedApplies: boolean): { hours: NonNullable<ReturnType<typeof buildHours>>; recorded: number | null } | null {
  const hours = buildHours(v.hours)
  const recorded = recordedApplies ? decimalOrUndefined(v.recorded) : undefined
  if (hours === null || (recorded !== undefined && Number.isNaN(recorded))) return null
  return { hours, recorded: recorded ?? null }
}

/** نتيجة المعاينة بالريال، ثم الموازنات غير المحمّلة في قسم منفصل خارج كل إجمالي (§10 و§11). */
export function PreviewResult({ preview, unallocated, testId }: {
  readonly preview: Preview205
  readonly unallocated: ReadonlyArray<{ budget_code: string; amount: unknown }>
  readonly testId: string
}) {
  const { t } = useTranslation()
  const riyal = useRiyal()
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm" data-testid={testId}>
      <p>{t('manufacturingSettings.costPolicy.preview.labor')}: {riyal(preview.labor.amount)}</p>
      {preview.overhead.map(o => (
        <p key={o.pool_code}>
          <span className="font-mono">{o.pool_code}</span> · {t(`manufacturingSettings.costPolicy.bases.${o.basis}`)}
          {o.activity && <> · {t(`${P}.activities.${o.activity}`)}</>}: {riyal(o.amount)}
        </p>
      ))}
      {preview.excluded_pools.map(code => (
        <p key={code} className="text-muted-foreground"><span className="font-mono">{code}</span>: {t('manufacturingSettings.costPolicy.preview.excluded')}</p>
      ))}
      <p>{t(`${P}.preview.overheadTotal`)}: {riyal(preview.overhead_total)}</p>
      <p className="font-medium">{t('manufacturingSettings.costPolicy.preview.total')}: {riyal(preview.total)}</p>
      {unallocated.length > 0 && (
        <div className="rounded-md bg-muted/50 p-2" data-testid={`${testId}-unallocated`}>
          <p className="font-medium">{t(`${P}.unallocatedTitle`)}</p>
          <p className="text-xs text-muted-foreground">{t(`${P}.preview.unallocatedOutside`)}</p>
          {unallocated.map(b => <p key={b.budget_code}><span className="font-mono">{b.budget_code}</span>: {riyal(b.amount)}</p>)}
        </div>
      )}
    </div>
  )
}

/**
 * معاينة 205 لإصدار مخزن (§10). لا تستدعي معاينة 204 أبدًا. القديم غير المعالج معطل مع السبب. أي
 * تغيير في الإصدار أو المركز أو الساعات أو المبلغ يخفي النتيجة والخطأ، ويغطي ردًا يصل متأخرًا.
 */
export function CostPolicy205Preview({ state, workCenters }: {
  readonly state: CostPolicy205State
  readonly workCenters: readonly CostPolicyWorkCenter[]
}) {
  const { t } = useTranslation()
  const live = state.versions.filter(v => v.status !== 'withdrawn')
  const [versionId, setVersionId] = useState('')
  const [inputs, setInputs] = useState<PreviewInputsText>(emptyPreviewInputs)
  const version = live.find(v => v.id === versionId)
  const recordedApplies = version?.labor_cost_source === 'recorded_entry_rate'
  const parsed = parsePreviewInputs(inputs, recordedApplies)
  const sentKey = (input: PreviewInput205) => JSON.stringify(input)
  const currentKey = version && parsed && inputs.workCenterId
    ? sentKey({ versionId, workCenterId: inputs.workCenterId, hours: parsed.hours, recordedLaborCost: parsed.recorded })
    : null
  const preview = useMutation({
    mutationFn: async (input: PreviewInput205) => ({ key: sentKey(input), result: await previewAbsorption205(state.orgId, input) }),
  })
  const shownKey = preview.data?.key ?? (preview.variables ? sentKey(preview.variables) : null)
  const matches = currentKey !== null && shownKey === currentKey
  const legacy = version?.policy_205 === 'legacy_unresolved'
  const canRun = Boolean(version && !legacy && parsed && inputs.workCenterId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`${P}.preview.title`)}</CardTitle>
        <p className="text-sm text-muted-foreground">{t(`${P}.preview.description`)}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="cp205-preview-version">{t('manufacturingSettings.costPolicy.preview.version')}</Label>
          <select id="cp205-preview-version" className={SELECT_205} value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            <option value="">{t('manufacturingSettings.gl.choose')}</option>
            {live.map(v => (
              <option key={v.id} value={v.id} disabled={v.policy_205 === 'legacy_unresolved'}>
                #{v.version_no} · {v.effective_from} · {t(`${P}.paths.${v.policy_205}`)}
              </option>
            ))}
          </select>
          {legacy && <p className="text-destructive" role="note">{t(`${P}.legacyRefused`)}</p>}
        </div>
        <PreviewInputs value={inputs} onChange={setInputs} workCenters={workCenters} recordedApplies={recordedApplies} idPrefix="cp205-preview" />
        <Button type="button" disabled={!canRun || preview.isPending}
          onClick={() => { if (version && parsed) preview.mutate({ versionId: version.id, workCenterId: inputs.workCenterId, hours: parsed.hours, recordedLaborCost: parsed.recorded }) }}>
          {t('manufacturingSettings.costPolicy.preview.run')}
        </Button>
        {matches && preview.isError && <p className="text-destructive" role="alert">{costPolicy205ErrorMessage(t, preview.error)}</p>}
        {matches && preview.data && (
          <PreviewResult preview={preview.data.result} unallocated={preview.data.result.unallocated_budgets} testId="cp205-preview-result" />
        )}
        {!matches && (preview.data || preview.isError) && <p className="text-muted-foreground" role="status">{t('manufacturingSettings.costPolicy.preview.stale')}</p>}
      </CardContent>
    </Card>
  )
}
