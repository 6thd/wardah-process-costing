import { useState } from 'react'
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
  createCostPolicyVersion,
  getCostPolicy,
  listCostPolicyWorkCenters,
  previewAbsorption,
  withdrawCostPolicyVersion,
  type AbsorptionPreview,
  type CostPolicyDraft,
  type CostPolicyState,
  type CostPolicyVersion,
} from '@/services/mfg-cost-policy-service'
import { CostPolicyVersionForm } from './CostPolicyVersionForm'
import { costPolicyErrorMessage } from './costPolicyError'
import { COST_POLICY_QUERY_KEY, COST_POLICY_WORK_CENTERS_QUERY_KEY } from './queryKeys'

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'

const STATUS_VARIANT: Record<CostPolicyVersion['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  current: 'default',
  scheduled: 'outline',
  superseded: 'secondary',
  withdrawn: 'destructive',
}

function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID()
}

export function CostPolicyTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const policy = useQuery({ queryKey: COST_POLICY_QUERY_KEY, queryFn: getCostPolicy, retry: false })
  const workCenters = useQuery({
    queryKey: COST_POLICY_WORK_CENTERS_QUERY_KEY, queryFn: listCostPolicyWorkCenters, enabled: policy.isSuccess,
  })
  const [formOpen, setFormOpen] = useState(false)
  // One key per submission attempt: a retry after a lost response replays the
  // same version instead of creating a second one.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
  const [withdrawing, setWithdrawing] = useState<{ id: string; reason: string } | null>(null)

  const refresh = (state: CostPolicyState) => queryClient.setQueryData(COST_POLICY_QUERY_KEY, state)

  const create = useMutation({
    mutationFn: (draft: CostPolicyDraft) =>
      createCostPolicyVersion(draft, policy.data?.latestVersionNo ?? 0, idempotencyKey),
    onSuccess: ({ state }) => {
      refresh(state)
      setFormOpen(false)
      setIdempotencyKey(newIdempotencyKey())
      toast.success(t('manufacturingSettings.costPolicy.created'))
    },
    onError: (error) => {
      toast.error(costPolicyErrorMessage(t, error))
      if (error instanceof Error && error.message.startsWith('COST_POLICY_VERSION_CONFLICT')) {
        void queryClient.invalidateQueries({ queryKey: COST_POLICY_QUERY_KEY })
      }
    },
  })

  const withdraw = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => withdrawCostPolicyVersion(id, reason),
    onSuccess: (state) => {
      refresh(state)
      setWithdrawing(null)
      toast.success(t('manufacturingSettings.costPolicy.withdrawn'))
    },
    onError: (error) => toast.error(costPolicyErrorMessage(t, error)),
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
  const base = live[0]
  const canWithdraw = (v: CostPolicyVersion) =>
    state.canManage && v.status !== 'withdrawn' && v.status !== 'superseded'
    && v.pinned_order_count === 0 && v.effective_from >= state.today

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
                      <td className="p-2">{v.pinned_order_count}</td>
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

          {withdrawing && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); withdraw.mutate(withdrawing) }}>
              <div className="flex-1 space-y-1">
                <Label htmlFor="cp-withdraw-reason">{t('manufacturingSettings.costPolicy.withdrawReason')}</Label>
                <Input id="cp-withdraw-reason" required maxLength={500} value={withdrawing.reason}
                  onChange={(e) => setWithdrawing({ ...withdrawing, reason: e.target.value })} />
              </div>
              <Button type="submit" variant="destructive" disabled={withdraw.isPending}>
                {t('manufacturingSettings.costPolicy.confirmWithdraw')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setWithdrawing(null)}>{t('manufacturingSettings.cancel')}</Button>
            </form>
          )}

          {state.canManage && !formOpen && (
            <Button onClick={() => setFormOpen(true)}>{t('manufacturingSettings.costPolicy.newVersion')}</Button>
          )}
          {state.canManage && formOpen && (
            <CostPolicyVersionForm
              state={state}
              base={base}
              workCenters={workCenters.data ?? []}
              saving={create.isPending}
              onSubmit={(draft) => create.mutate(draft)}
              onCancel={() => setFormOpen(false)}
            />
          )}
        </CardContent>
      </Card>

      {live.length > 0 && <AbsorptionPreviewCard versions={live} workCenters={workCenters.data ?? []} />}
    </div>
  )
}

function AbsorptionPreviewCard({ versions, workCenters }: {
  readonly versions: readonly CostPolicyVersion[]
  readonly workCenters: ReadonlyArray<{ id: string; code: string; name: string; nameAr: string | null }>
}) {
  const { t } = useTranslation()
  const [versionId, setVersionId] = useState(versions[0]?.id ?? '')
  const [workCenterId, setWorkCenterId] = useState('')
  const [laborHours, setLaborHours] = useState('')
  const [machineHours, setMachineHours] = useState('')
  const [recordedCost, setRecordedCost] = useState('')
  const version = versions.find(v => v.id === versionId)
  const usesRecorded = version?.labor_cost_source === 'recorded_entry_rate'
  // Empty means "not measured" (NULL), which the database refuses; 0 is a measured zero.
  const toNumber = (value: string) => value.trim() === '' ? null : Number(value)

  const preview = useMutation({
    mutationFn: () => previewAbsorption({
      versionId, workCenterId,
      laborHours: toNumber(laborHours), machineHours: toNumber(machineHours),
      recordedLaborCost: usesRecorded ? toNumber(recordedCost) : null,
    }),
  })
  const result: AbsorptionPreview | undefined = preview.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('manufacturingSettings.costPolicy.preview.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('manufacturingSettings.costPolicy.preview.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); preview.mutate() }}>
          <select aria-label={t('manufacturingSettings.costPolicy.preview.version')} className={SELECT_CLASS}
            value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            {versions.map(v => <option key={v.id} value={v.id}>#{v.version_no} · {v.effective_from}</option>)}
          </select>
          <select aria-label={t('manufacturingSettings.costPolicy.form.workCenter')} className={SELECT_CLASS} required
            value={workCenterId} onChange={(e) => setWorkCenterId(e.target.value)}>
            <option value="">{t('manufacturingSettings.gl.choose')}</option>
            {workCenters.map(wc => <option key={wc.id} value={wc.id}>{wc.code}</option>)}
          </select>
          <Input aria-label={t('manufacturingSettings.costPolicy.preview.laborHours')} type="number" min="0" step="any"
            value={laborHours} onChange={(e) => setLaborHours(e.target.value)} />
          <Input aria-label={t('manufacturingSettings.costPolicy.preview.machineHours')} type="number" min="0" step="any"
            value={machineHours} onChange={(e) => setMachineHours(e.target.value)} />
          {usesRecorded && (
            <Input aria-label={t('manufacturingSettings.costPolicy.preview.recordedCost')} type="number" min="0" step="any"
              value={recordedCost} onChange={(e) => setRecordedCost(e.target.value)} />
          )}
          <Button type="submit" disabled={preview.isPending || !workCenterId}>
            {t('manufacturingSettings.costPolicy.preview.run')}
          </Button>
        </form>
        {preview.isError && <p role="alert" className="text-sm text-destructive">{costPolicyErrorMessage(t, preview.error)}</p>}
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
