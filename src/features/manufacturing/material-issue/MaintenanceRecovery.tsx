import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/button'
import { acknowledgeRejectedMaterialIssueSetup, recoverMaterialIssueSetup } from '@/services/manufacturing/materialIssueMaintenance'

/** Recovery is independent of new-issue context, which may no longer be eligible. */
export function MaintenanceRecovery({ moId, identity }: { moId?: string; identity: string }) {
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
  async function act(scope: string | undefined, dismiss: boolean) {
    if (lock.current || !live.current || !currentAllowed.current) return
    lock.current = true; setBusy(true); setMessage('')
    try {
      if (dismiss) await acknowledgeRejectedMaterialIssueSetup(scope)
      else await recoverMaterialIssueSetup(scope)
      if (live.current && currentAllowed.current) {
        setMessage(t('materialIssue.setupRecovered'))
        if (!dismiss) void cache.invalidateQueries().catch(() => undefined)
      }
    } catch { if (live.current) setMessage(t('materialIssue.setupUnresolved')) }
    finally { lock.current = false; if (live.current) setBusy(false) }
  }
  return <div className="space-y-2">
    <p>{t('materialIssue.setupRecovery')}</p>
    <Button disabled={busy} onClick={() => void act(undefined, false)}>{t('materialIssue.retryOrderCreation')}</Button>
    <Button disabled={busy} onClick={() => void act(undefined, true)}>{t('materialIssue.dismissRejectedCreation')}</Button>
    <Button disabled={busy || !moId} onClick={() => void act(moId, false)}>{t('materialIssue.retrySetup')}</Button>
    <Button disabled={busy || !moId} onClick={() => void act(moId, true)}>{t('materialIssue.dismissRejectedSetup')}</Button>
    {message && <p role="status">{message}</p>}
  </div>
}
