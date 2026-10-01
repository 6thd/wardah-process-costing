import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { supabase } from '@/lib/supabase'
import { listPendingMaterialIssueSetup } from '@/services/manufacturing/materialIssueMaintenance'
import { Button } from '@/components/ui/button'
import { claimMaterialIssue, pendingMaterialIssue, sendMaterialIssue, acknowledgeRejectedMaterialIssue,
  getMaterialIssuePolicy, type MaterialIssueRecord, type MaterialIssuePolicy } from '@/services/manufacturing/materialIssueClient'
import { CONSUME_KEY, getIssueOrders, getIssueContext, issueCommand,
  type IssueContext, type IssueOrder, type IssueDraftLine } from '@/services/manufacturing/materialIssueOptions'
import { MaintenanceRecovery } from './MaintenanceRecovery'
import { MaterialIssuePreparation } from './MaterialIssuePreparation'
import { isolatedMaterialIssueEnabled } from './gate'
import './material-issue.css'

const emptyLine = (): IssueDraftLine => ({ reservation: '', warehouse: '', workOrder: '', uom: '', quantity: '', notes: '' })
export function MaterialIssuePage() {
  const auth = useAuth()
  const permissions = usePermissions()
  const { t } = useTranslation()
  const identity = `${auth.user?.id || ''}:${auth.currentOrgId || ''}`
  const contextReady = !auth.loading && !!auth.user && !!auth.currentOrgId
    && !permissions.loading && !permissions.error && permissions.permissionIdentityKey === identity
  const maintenanceAllowed = contextReady && ['manufacturing.material_issue_setup.prepare',
    'manufacturing.material_reservation.reserve', 'manufacturing.material_reservation.release']
    .some(key => permissions.hasPermissionKey(key))
  const allowed = !auth.loading && !!auth.user && !!auth.currentOrgId
    && !permissions.loading && !permissions.error && permissions.permissionIdentityKey === identity
    && permissions.hasPermissionKey(CONSUME_KEY)
  if (!isolatedMaterialIssueEnabled()) return <p role="status">{t('materialIssue.hold')}</p>
  if (!allowed || !auth.user || !auth.currentOrgId) {
    if (maintenanceAllowed && auth.currentOrgId && auth.user) return <>
      <MaterialIssuePreparation key={`prepare:${identity}`} userId={auth.user.id} orgId={auth.currentOrgId} />
      <PreparationRecovery key={identity} identity={identity} orgId={auth.currentOrgId} />
    </>
    return <p role="status">{t('materialIssue.denied')}</p>
  }
  return <>
    {maintenanceAllowed && <MaterialIssuePreparation key={`prepare:${identity}`} userId={auth.user.id} orgId={auth.currentOrgId} />}
    <IssueForm key={identity} userId={auth.user.id} orgId={auth.currentOrgId} />
  </>
}
function PreparationRecovery({ identity, orgId }: { identity: string; orgId: string }) {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const [storageFailed, setStorageFailed] = useState(false)
  const [mo, setMo] = useState('')
  useEffect(() => {
    let active = true
    setStorageFailed(false)
    listPendingMaterialIssueSetup().then(rows => {
      if (active) setOrders([...new Set(rows.flatMap(row => row.moId ? [row.moId] : []))])
    }).catch(() => { if (active) setStorageFailed(true) })
    return () => { active = false }
  }, [orgId, identity, reload])
  return <section className="material-issue-page space-y-4 p-4">
    <label>{t('materialIssue.mo')}<select value={mo} onChange={event => setMo(event.target.value)}>
      <option value="">{t('materialIssue.choose')}</option>
      {orders.map(id => <option key={id} value={id}>{id}</option>)}
    </select></label>
    <Button onClick={() => setReload(value => value + 1)}>{t('materialIssue.refresh')}</Button>
    {storageFailed && <p role="alert">{t('materialIssue.storageFailed')}</p>}
    <MaintenanceRecovery identity={identity} moId={mo || undefined} onRecovered={() => setReload(value => value + 1)} />
  </section>
}
function IssueForm({ userId, orgId }: { userId: string; orgId: string }) {
  const { t } = useTranslation()
  const permissions = usePermissions()
  const queryClient = useQueryClient()
  const [orders, setOrders] = useState<IssueOrder[] | null>(null)
  const [mo, setMo] = useState('')
  const [stage, setStage] = useState('')
  const [context, setContext] = useState<IssueContext | null>(null)
  const [policy, setPolicy] = useState<MaterialIssuePolicy | null>(null)
  const [pending, setPending] = useState<MaterialIssueRecord | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const [drafts, setDrafts] = useState<IssueDraftLine[]>([emptyLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState('')
  const [reload, setReload] = useState(0)
  const live = useRef(false)
  const actionLock = useRef(false)
  useEffect(() => {
    live.current = true
    // Request persistence where supported; a grant is not an eviction guarantee.
    void navigator.storage?.persist?.().catch(() => false)
    return () => { live.current = false }
  }, [])
  useEffect(() => {
    let active = true
    setOrders(null)
    getIssueOrders(orgId).then(rows => { if (active) setOrders(rows) })
      .catch(() => { if (active) setError(t('materialIssue.loadFailed')) })
    return () => { active = false }
  }, [orgId, reload, t])
  useEffect(() => {
    let active = true
    setContext(null); setPolicy(null); setPending(null); setStorageReady(false)
    setStage(''); setDrafts([emptyLine()]); setError('')
    if (!mo) return () => { active = false }
    // Recover the durable slot even if new-issue choices are no longer usable.
    pendingMaterialIssue(userId, mo).then(record => {
      if (!active) return
      if (record && record.orgId !== orgId) throw new Error('MATERIAL_ISSUE_ORG_CHANGED')
      setPending(record); setStorageReady(true)
    }).catch(() => { if (active) setError(t('materialIssue.storageFailed')) })
    Promise.all([getIssueContext(orgId, mo), getMaterialIssuePolicy(orgId)]).then(([snapshot, settings]) => {
      if (active) { setContext(snapshot); setPolicy(settings) }
    }).catch(() => { if (active) setError(t('materialIssue.loadFailed')) })
    return () => { active = false }
  }, [mo, userId, orgId, reload, t])
  useEffect(() => {
    const refresh = () => { if (!actionLock.current) { setContext(null); setPolicy(null); setReload(value => value + 1) } }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  async function act(kind: 'new' | 'retry' | 'acknowledge') {
    if (actionLock.current || !live.current || !storageReady || permissions.loading || permissions.error
      || permissions.permissionIdentityKey !== `${userId}:${orgId}` || !permissions.hasPermissionKey(CONSUME_KEY)) return
    actionLock.current = true; setBusy(true); setError(''); setReceipt('')
    let event = pending
    try {
      const { data, error: identityError } = await supabase.auth.getUser()
      if (!live.current) return
      if (identityError || data.user?.id !== userId) throw new Error('MATERIAL_ISSUE_ACTOR_CHANGED')
      if (kind === 'acknowledge') {
        if (!event) return
        await acknowledgeRejectedMaterialIssue(event.eventId)
        if (live.current) { setPending(null); setReload(value => value + 1) }
        return
      }
      if (kind === 'new') {
        if (!context || !policy || event) return
        event = await claimMaterialIssue(issueCommand(context, userId, stage, drafts))
        if (live.current) setPending(event)
      }
      if (!live.current || !event || event.orgId !== orgId || event.userId !== userId) return
      const result = await sendMaterialIssue(event.eventId)
      if (live.current) {
        setPending(null); setReceipt(result.event_id); setReload(value => value + 1)
        // Invalidate related cached reads only after a verified acknowledgement.
        void queryClient.invalidateQueries({ predicate: query => query.queryKey.some(key =>
          typeof key === 'string' && /manufactur|invent|product|material|reserv|stock|bin|wip|mes/i.test(key)) })
          .catch(() => undefined)
      }
    } catch {
      if (live.current) {
        setStorageReady(false)
        try {
          const record = await pendingMaterialIssue(userId, mo)
          if (live.current) { setPending(record); setStorageReady(true) }
        } catch { /* Failed storage recovery keeps every send blocked. */ }
        if (live.current) setError(t('materialIssue.actionFailed'))
      }
    } finally { actionLock.current = false; if (live.current) setBusy(false) }
  }
  function edit(index: number, field: keyof IssueDraftLine, value: string) {
    setDrafts(rows => rows.map((row, i) => i !== index ? row : field === 'reservation'
      ? { ...emptyLine(), reservation: value } : { ...row, [field]: value }))
  }
  let valid = false
  try { if (context && policy) { issueCommand(context, userId, stage, drafts); valid = true } } catch { /* Incomplete selection. */ }
  const rejected = pending?.attempts.length && pending.attempts.every(attempt => attempt.state === 'rejected')
  const choose = t('materialIssue.choose')
  return <section className="material-issue-page space-y-4 p-4">
    <h1 className="text-xl font-semibold">{t('materialIssue.title')}</h1>
    <p className="text-sm text-muted-foreground">{t('materialIssue.storageNotice')}</p>
    <label>{t('materialIssue.mo')}<select aria-label={t('materialIssue.mo')} value={mo} disabled={busy || !orders}
      onChange={event => { setReceipt(''); setMo(event.target.value) }}>
      <option value="">{choose}</option>{orders?.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
    </select></label>
    <Button disabled={busy} onClick={() => setReload(value => value + 1)}>{t('materialIssue.refresh')}</Button>
    <MaintenanceRecovery key={`${userId}:${orgId}`} identity={`${userId}:${orgId}`} moId={mo || undefined} />
    {error && <p role="alert">{error}</p>}
    {receipt && <p role="status">{t('materialIssue.succeeded')} <code>{receipt}</code></p>}
    {policy && <p>{t('materialIssue.policyVersion')}: {policy.version} — {policy.allowed_statuses.join(', ')}</p>}
    {pending ? <div className="space-y-2">
      <p role="status">{t('materialIssue.pending')} <code>{pending.eventId}</code></p>
      <p>{t('materialIssue.frozenPayload')}</p>
      <pre className="overflow-auto text-xs">{JSON.stringify({ stage: pending.stageId, lines: pending.lines }, null, 2)}</pre>
      <Button disabled={busy || !storageReady} onClick={() => void act('retry')}>{t('materialIssue.retry')}</Button>
      {!!rejected && <Button disabled={busy} onClick={() => void act('acknowledge')}>{t('materialIssue.acknowledge')}</Button>}
    </div> : mo && <fieldset disabled={busy || !context || !policy || !storageReady} className="space-y-3">
      <label>{t('materialIssue.stage')}<select aria-label={t('materialIssue.stage')} value={stage} onChange={event => setStage(event.target.value)}>
        <option value="">{choose}</option>{context?.stages.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
      </select></label>
      {drafts.map((line, index) => {
        const reservation = context?.reservations.find(row => row.id === line.reservation)
        return <div key={index} className="grid gap-3 rounded-md border p-4 md:grid-cols-2">
          <label>{t('materialIssue.reservation')}<select aria-label={`${t('materialIssue.reservation')} ${index + 1}`} value={line.reservation} onChange={event => edit(index, 'reservation', event.target.value)}>
            <option value="">{choose}</option>{context?.reservations.map(row => <option key={row.id} value={row.id}>{row.label} ({row.remaining})</option>)}
          </select></label>
          <label>{t('materialIssue.wo')}<select aria-label={`${t('materialIssue.wo')} ${index + 1}`} value={line.workOrder} onChange={event => edit(index, 'workOrder', event.target.value)}>
            <option value="">{choose}</option>{context?.work_orders.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select></label>
          <label>{t('materialIssue.warehouse')}<select aria-label={`${t('materialIssue.warehouse')} ${index + 1}`} value={line.warehouse} onChange={event => edit(index, 'warehouse', event.target.value)}>
            <option value="">{choose}</option>{context?.warehouses.filter(row => reservation && row.product_ids.includes(reservation.product_id)).map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select></label>
          <label>{t('materialIssue.uom')}<select aria-label={`${t('materialIssue.uom')} ${index + 1}`} value={line.uom} onChange={event => edit(index, 'uom', event.target.value)}>
            <option value="">{choose}</option>{reservation && <option value={reservation.uom_id}>{reservation.uom_label}</option>}
          </select></label>
          <label>{t('materialIssue.quantity')}<input aria-label={`${t('materialIssue.quantity')} ${index + 1}`} inputMode="decimal" value={line.quantity} onChange={event => edit(index, 'quantity', event.target.value)} /></label>
          <label>{t('materialIssue.notes')}<input aria-label={`${t('materialIssue.notes')} ${index + 1}`} value={line.notes} onChange={event => edit(index, 'notes', event.target.value)} /></label>
          {drafts.length > 1 && <Button onClick={() => setDrafts(rows => rows.filter((_, i) => i !== index))}>{t('materialIssue.removeLine')}</Button>}
        </div>
      })}
      <Button onClick={() => setDrafts(rows => [...rows, emptyLine()])}>{t('materialIssue.addLine')}</Button>
      <Button disabled={!valid || busy || !storageReady} onClick={() => void act('new')}>{t('materialIssue.submit')}</Button>
    </fieldset>}
  </section>
}
