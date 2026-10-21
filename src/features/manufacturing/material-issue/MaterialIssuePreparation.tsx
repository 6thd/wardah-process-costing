import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/usePermissions'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { manageMaterialIssueSetup, listPendingMaterialIssueSetup, type MaintenanceCommand } from '@/services/manufacturing/materialIssueMaintenance'
import { getPreparationCatalog, getPreparationReservationUnit, type PreparationUnit, preparationKeys, preparationQuantity, preparationStatus, reservationBalance, displayedParentVersion,
  resizePreparationReservation, releasePreparationReservation, type PreparationCatalog, type PreparationRow } from '@/services/manufacturing/materialIssuePreparation'
import { WipLogFormDialog } from '../components/WipLogFormDialog'
import { MaintenanceRecovery } from './MaintenanceRecovery'

function selected<T>(row: T | null | undefined): T { if (!row) throw new Error('INVALID_ISSUE_SETUP_SCOPE'); return row }
const label = (row: PreparationRow) => String(row.order_number || row.operation_name || row.name || row.code || row.id)
export function MaterialIssuePreparation({ userId, orgId }: { userId: string; orgId: string }) {
  const { t } = useTranslation(); const [open, setOpen] = useState(false)
  return <section className="material-issue-page space-y-3 p-4" aria-label={t('materialIssue.preparationTitle')}>
    <Button aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('materialIssue.preparationTitle')}</Button>
    {open && <PreparationForm key={`${userId}:${orgId}`} userId={userId} orgId={orgId} />}
  </section>
}
function PreparationForm({ userId, orgId }: { userId: string; orgId: string }) {
  const { t } = useTranslation(); const permissions = usePermissions(); const cache = useQueryClient()
  const [catalog, setCatalog] = useState<PreparationCatalog | null>(null)
  const [pending, setPending] = useState<Awaited<ReturnType<typeof listPendingMaterialIssueSetup>>>([])
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  const [moId, setMoId] = useState(''); const [productId, setProductId] = useState(''); const [number, setNumber] = useState('')
  const [orderQty, setOrderQty] = useState(''); const [moStatus, setMoStatus] = useState('')
  const [center, setCenter] = useState(''); const [woName, setWoName] = useState(''); const [woQty, setWoQty] = useState('')
  const [woId, setWoId] = useState(''); const [woStatus, setWoStatus] = useState('')
  const [itemId, setItemId] = useState(''); const [reserveQty, setReserveQty] = useState('')
  const [unit, setUnit] = useState<PreparationUnit | null>(null)
  const [resId, setResId] = useState(''); const [changeQty, setChangeQty] = useState(''); const [wip, setWip] = useState(false)
  const live = useRef(false); const lock = useRef(false); const generation = useRef(0)
  const identity = `${userId}:${orgId}`
  const can = (operation: MaintenanceCommand['operation']) => !permissions.loading && !permissions.error
    && permissions.permissionIdentityKey === identity && preparationKeys(operation).every(key => permissions.hasPermissionKey(key))
  const currentCan = useRef(can); currentCan.current = can
  const canReserve = can('reserve')
  useEffect(() => {
    let active = true; setUnit(null)
    if (itemId && canReserve) getPreparationReservationUnit(orgId, itemId, userId)
      .then(value => { if (active) setUnit(value) })
      .catch(() => { if (active) setMessage(t('materialIssue.preparationUnitFailed')) })
    return () => { active = false }
  }, [itemId, orgId, userId, canReserve, t])
  const refresh = useCallback(async () => {
    const request = ++generation.current; setReady(false); setCatalog(null)
    try {
      // Pending events remain recoverable even if catalog reads fail.
      const saved = await listPendingMaterialIssueSetup()
      if (!live.current || request !== generation.current) return
      setPending(saved)
      const rows = await getPreparationCatalog(orgId, userId)
      if (live.current && request === generation.current) { setCatalog(rows); setReady(true) }
    } catch { if (live.current && request === generation.current) setMessage(t('materialIssue.preparationLoadFailed')) }
  }, [orgId, userId, t])
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false } }, [refresh])
  const mo = catalog?.manufacturing_orders.find(row => row.id === moId)
  const wo = catalog?.work_orders.find(row => row.id === woId && row.mo_id === moId)
  const res = catalog?.material_reservations.find(row => row.id === resId && row.mo_id === moId)
  const product = res && catalog?.products.find(row => row.id === res.product_id)
  const held = pending.some(row => row.moId === moId)
  const createHeld = pending.some(row => !row.moId)
  async function submit(build: () => MaintenanceCommand) {
    if (lock.current || !live.current || !ready) return
    let command: MaintenanceCommand
    try { command = build() } catch { setMessage(t('materialIssue.preparationInvalid')); return }
    if (!currentCan.current(command.operation) || pending.some(row => (row.moId || '') === (command.mo_id || ''))) return
    lock.current = true; setBusy(true); setMessage('')
    try {
      const { data, error } = await supabase.auth.getUser()
      if (!live.current || !currentCan.current(command.operation)) return
      if (error || data.user?.id !== userId) throw new Error('ISSUE_SETUP_IDENTITY_CHANGED')
      const entity = await manageMaterialIssueSetup(command)
      if (!live.current || !currentCan.current(command.operation)) return
      if (command.operation === 'create_order') { setMoId(String(entity.id)); setNumber(''); setOrderQty('') }
      setMessage(t('materialIssue.preparationSaved'))
      void cache.invalidateQueries({ predicate: query => query.queryKey.some(key =>
        typeof key === 'string' && /manufactur|material|reserv|wip|mes/i.test(key)) }).catch(() => undefined)
    } catch { if (live.current) setMessage(t('materialIssue.preparationFailed')) }
    finally { lock.current = false; if (live.current) { setBusy(false); await refresh() } }
  }
  const choose = t('materialIssue.choose')
  const select = (key: string, value: string, change: (value: string) => void, rows: PreparationRow[], disabled = false) =>
    <label>{t(`materialIssue.${key}`)}<select aria-label={t(`materialIssue.${key}`)} value={value}
      disabled={disabled || busy || !ready} onChange={event => change(event.target.value)}>
      <option value="">{choose}</option>{rows.map(row => <option key={row.id} value={row.id}>{label(row)}</option>)}
    </select></label>
  const input = (key: string, value: string, change: (value: string) => void, decimal = false) =>
    <label>{t(`materialIssue.${key}`)}<input aria-label={t(`materialIssue.${key}`)} value={value}
      inputMode={decimal ? 'decimal' : undefined} onChange={event => change(event.target.value)} /></label>
  const statuses = (key: string, value: string, change: (value: string) => void, values: string[]) =>
    select(key, value, change, values.map(id => ({ id, org_id: orgId, name: id })))
  const act = (key: string, operation: MaintenanceCommand['operation'], build: () => MaintenanceCommand, disabled = false) =>
    <Button disabled={busy || !ready || !can(operation) || disabled} onClick={() => void submit(build)}>{t(`materialIssue.${key}`)}</Button>
  let balance = ''
  try { if (res) balance = String(reservationBalance(res)) } catch { balance = t('materialIssue.preparationInvalid') }
  return <div className="space-y-4">
    <p>{t('materialIssue.preparationNotice')}</p>
    <Button disabled={busy} onClick={() => void refresh()}>{t('materialIssue.preparationRefresh')}</Button>
    {message && <p role="status">{message}</p>}
    <fieldset disabled={busy || !ready || createHeld} className="grid gap-3 rounded-md border p-4 md:grid-cols-2">
      <legend>{t('materialIssue.createPreparationOrder')}</legend>
      {select('preparationProduct', productId, setProductId, catalog?.products.filter(row => row.is_active === true) || [])}
      {input('preparationOrderNumber', number, setNumber)}{input('preparationOrderQuantity', orderQty, setOrderQty, true)}
      {act('createPreparationOrder', 'create_order', () => {
        if (!catalog?.products.some(row => row.id === productId && row.is_active === true) || !number.trim()) throw new Error('INVALID')
        return { operation: 'create_order', order: { product_id: productId, order_number: number.trim(), quantity: preparationQuantity(orderQty) }, materials: [] }
      }, !productId || !number.trim() || !orderQty || createHeld)}
    </fieldset>
    {select('preparationOrder', moId, id => { setMoId(id); setWoId(''); setResId(''); setMoStatus(''); setWoStatus(''); setChangeQty('') }, catalog?.manufacturing_orders || [])}
    {mo && <p>{t('materialIssue.currentStatus')}: {String(mo.status)} · {t('materialIssue.displayedVersion')}: {String(mo.maintenance_version)}</p>}
    {held && <p role="alert">{t('materialIssue.preparationPending')}</p>}
    <MaintenanceRecovery identity={identity} moId={moId || undefined} onRecovered={() => void refresh()} />
    <fieldset disabled={busy || !ready || !mo || held} className="space-y-3 rounded-md border p-4">
      <legend>{t('materialIssue.orderEligibility')}</legend>
      {statuses('preparationOrderStatus', moStatus, setMoStatus, ['confirmed', 'in_progress', 'on_hold'])}
      {act('saveOrderEligibility', 'set_order_status', () => preparationStatus(selected(mo), moStatus), !moStatus)}
    </fieldset>
    <fieldset disabled={busy || !ready || !mo || held} className="grid gap-3 rounded-md border p-4 md:grid-cols-2">
      <legend>{t('materialIssue.manualWorkOrder')}</legend>
      {select('preparationWorkCenter', center, setCenter, catalog?.work_centers.filter(row => row.is_active === true) || [])}
      {input('preparationWorkName', woName, setWoName)}{input('preparationWorkQuantity', woQty, setWoQty, true)}
      {act('createPreparationWorkOrder', 'create_work_order', () => {
        const qty = preparationQuantity(woQty, 4, 100_000_000)
        if (!catalog?.work_centers.some(row => row.id === center && row.is_active === true) || !woName.trim() || qty > Number(selected(mo).quantity)) throw new Error('INVALID')
        return { operation: 'create_work_order', mo_id: selected(mo).id, work_center_id: center, name: woName.trim(), quantity: qty,
          expected_version: displayedParentVersion(selected(mo).maintenance_version) }
      }, !center || !woName.trim() || !woQty)}
      {select('preparationWorkOrder', woId, setWoId, catalog?.work_orders.filter(row => row.mo_id === moId) || [])}
      {wo && <p>{t('materialIssue.currentStatus')}: {String(wo.status)} · {t('materialIssue.displayedVersion')}: {String(wo.maintenance_version)}</p>}
      {statuses('preparationWorkStatus', woStatus, setWoStatus, ['READY', 'IN_SETUP', 'IN_PROGRESS', 'ON_HOLD'])}
      {act('saveWorkEligibility', 'set_work_order_status', () => preparationStatus(selected(wo), woStatus, true), !wo || !woStatus || mo?.status !== 'in_progress')}
    </fieldset>
    <fieldset disabled={busy || !ready || !mo || held} className="grid gap-3 rounded-md border p-4 md:grid-cols-2">
      <legend>{t('materialIssue.prepareReservation')}</legend>
      {select('preparationItem', itemId, setItemId, catalog?.items || [])}{input('preparationReserveQuantity', reserveQty, setReserveQty, true)}
      {unit && <p>{t('materialIssue.preparationBaseUnit')}: {unit.uom_id} · {String(catalog?.products.find(row => row.id === unit.product_id)?.name || unit.product_id)}</p>}
      {act('createPreparationReservation', 'reserve', () => {
        if (!catalog?.items.some(row => row.id === itemId) || unit?.item_id !== itemId) throw new Error('INVALID')
        return { operation: 'reserve', mo_id: selected(mo).id, item_id: itemId, uom_id: unit.uom_id, quantity: preparationQuantity(reserveQty),
          expected_version: displayedParentVersion(selected(mo).maintenance_version) }
      }, !itemId || !reserveQty || !unit)}
      {select('preparationReservation', resId, setResId, catalog?.material_reservations.filter(row => row.mo_id === moId).map(row => ({ ...row, name: String(catalog.products.find(product => product.id === row.product_id)?.name || row.product_id) + ' · ' + String(row.status) + ' · ' + row.id })) || [])}
      {res && <p>{t('materialIssue.preparationBaseUnit')}: {String(res.uom_id)} · {t('materialIssue.remaining')}: {balance} · {t('materialIssue.displayedVersion')}: {String(res.maintenance_version)}</p>}
      {input('preparationChangeQuantity', changeQty, setChangeQty, true)}
      {act('resizePreparationReservation', 'resize_reservation', () => resizePreparationReservation(selected(res), selected(product), changeQty), !res || !product || !changeQty)}
      {act('releasePreparationReservation', 'release_reservation', () => releasePreparationReservation(selected(res), changeQty), !res || !changeQty)}
      <p>{t('materialIssue.reservationHistoryNotice')}</p>
    </fieldset>
    <Button disabled={busy || !ready || held || !mo || !can('open_stage_wip')} onClick={() => setWip(true)}>{t('materialIssue.openPreparationStage')}</Button>
    <WipLogFormDialog open={wip} onOpenChange={value => { setWip(value); if (!value) void refresh() }}
      canSubmit={can('open_stage_wip') && !held} manufacturingOrders={mo ? [{ id: mo.id, label: label(mo) }] : []}
      stages={catalog?.manufacturing_stages.filter(row => row.is_active === true).map(row => ({ id: row.id, label: label(row) })) || []} />
  </div>
}
