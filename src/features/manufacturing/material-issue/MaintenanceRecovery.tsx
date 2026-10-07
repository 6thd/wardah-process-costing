import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/button'
import { acknowledgeRejectedMaterialIssueSetup, recoverMaterialIssueSetup, reconcileMaterialIssueSetup } from '@/services/manufacturing/materialIssueMaintenance'

/** Recovery is independent of new-issue context, which may no longer be eligible. */
export function MaintenanceRecovery({ moId, identity, onRecovered }: { moId?: string; identity: string; onRecovered?: () => void }) {
  const { t } = useTranslation()
  const permissions = usePermissions()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const live = useRef(false)
  const lock = useRef(false)
  const allowed = !permissions.loading && !permissions.error && permissions.permissionIdentityKey === identity
    && ['manufacturing.material_issue_setup.prepare', 'manufacturing.material_reservation.reserve',
      'manufacturing.material_reservation.release'].some(key => permissions.hasPermissionKey(key))
  const currentAllowed = useRef(allowed)
  currentAllowed.current = allowed
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  if (!allowed) return null
  async function act(scope: string | undefined, kind: 'retry' | 'dismiss' | 'reconcile') {
    if (lock.current || !live.current || !currentAllowed.current) return
    lock.current = true; setBusy(true); setMessage('')
    try {
      let closed = false
      if (kind === 'dismiss') await acknowledgeRejectedMaterialIssueSetup(scope)
      else if (kind === 'reconcile') closed = await reconcileMaterialIssueSetup(scope) === 'closed'
      else await recoverMaterialIssueSetup(scope)
      if (live.current && currentAllowed.current) {
        setMessage(t(closed ? 'materialIssue.setupClosed' : 'materialIssue.setupRecovered'))
        if (kind !== 'dismiss' && !closed) void cache.invalidateQueries().catch(() => undefined)
        onRecovered?.()
      }
    } catch { if (live.current) setMessage(t('materialIssue.setupUnresolved')) }
    finally { lock.current = false; if (live.current) setBusy(false) }
  }
  return <div className="space-y-2">
    <p>{t('materialIssue.setupRecovery')}</p>
    <Button disabled={busy} onClick={() => void act(undefined, 'retry')}>{t('materialIssue.retryOrderCreation')}</Button>
    <Button disabled={busy} onClick={() => void act(undefined, 'dismiss')}>{t('materialIssue.dismissRejectedCreation')}</Button>
    <Button disabled={busy} onClick={() => void act(undefined, 'reconcile')}>{t('materialIssue.reconcileOrderCreation')}</Button>
    <Button disabled={busy || !moId} onClick={() => void act(moId, 'retry')}>{t('materialIssue.retrySetup')}</Button>
    <Button disabled={busy || !moId} onClick={() => void act(moId, 'dismiss')}>{t('materialIssue.dismissRejectedSetup')}</Button>
    <Button disabled={busy || !moId} onClick={() => void act(moId, 'reconcile')}>{t('materialIssue.reconcileSetup')}</Button>
    {message && <p role="status">{message}</p>}
  </div>
}
