import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { supabase } from '@/lib/supabase'
import { getMaterialIssuePolicy, setMaterialIssuePolicy, type MaterialIssuePolicy } from '@/services/manufacturing/materialIssueClient'
import { CONSUME_KEY } from '@/services/manufacturing/materialIssueOptions'
import { isolatedMaterialIssueEnabled } from './gate'
import { MaterialIssueDecisionDraft } from './MaterialIssueDecisionDraft'
import './material-issue.css'
export function MaterialIssuePolicyPage() {
  const auth = useAuth()
  const permissions = usePermissions()
  const { t } = useTranslation()
  const identity = `${auth.user?.id || ''}:${auth.currentOrgId || ''}`
  if (!isolatedMaterialIssueEnabled()) return <p role="status">{t('materialIssue.hold')}</p>
  if (auth.loading || !auth.user || !auth.currentOrgId || permissions.loading || permissions.error
    || permissions.permissionIdentityKey !== identity
    || !(permissions.isOrgAdmin || permissions.hasPermissionKey(CONSUME_KEY))) {
    return <p role="status">{t('materialIssue.denied')}</p>
  }
  return <PolicyForm key={identity} orgId={auth.currentOrgId} userId={auth.user.id} />
}
function PolicyForm({ orgId, userId }: { orgId: string; userId: string }) {
  const { t } = useTranslation()
  const permissions = usePermissions()
  const [policy, setPolicy] = useState<MaterialIssuePolicy | null>(null)
  const [ready, setReady] = useState(false)
  const [inSetup, setInSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const live = useRef(false)
  const lock = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  function display(value: MaterialIssuePolicy) {
    setPolicy(value); setReady(value.allowed_statuses.includes('READY')); setInSetup(value.allowed_statuses.includes('IN_SETUP'))
  }
  useEffect(() => {
    let active = true
    setPolicy(null); setError('')
    getMaterialIssuePolicy(orgId).then(value => { if (active) display(value) })
      .catch(() => { if (active) setError(t('materialIssue.loadFailed')) })
    return () => { active = false }
  }, [orgId, reload, t])
  useEffect(() => {
    const refresh = () => { if (!lock.current) { setPolicy(null); setReload(value => value + 1) } }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  const canEdit = permissions.isOrgAdmin && !permissions.loading && !permissions.error
    && permissions.permissionIdentityKey === `${userId}:${orgId}`
  const currentCanEdit = useRef(canEdit)
  currentCanEdit.current = canEdit
  async function save() {
    if (!policy || !canEdit || lock.current || !live.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const { data, error: identityError } = await supabase.auth.getUser()
      if (!live.current || !currentCanEdit.current) return
      if (identityError || data.user?.id !== userId) throw new Error('MATERIAL_ISSUE_ACTOR_CHANGED')
      await setMaterialIssuePolicy(orgId, ready, inSetup)
      // M192 uses last-writer-wins, with no expected-version parameter.
      const current = await getMaterialIssuePolicy(orgId)
      if (live.current) display(current)
    } catch {
      if (live.current) { setPolicy(null); setError(t('materialIssue.policySaveFailed')) }
    } finally { lock.current = false; if (live.current) setBusy(false) }
  }
  return <section className="material-issue-page space-y-4 p-4">
    <h1 className="text-xl font-semibold">{t('materialIssue.policyTitle')}</h1>
    <p>{t('materialIssue.lastWriterWins')}</p>
    {error && <p role="alert">{error}</p>}
    {policy && <p>{t('materialIssue.policyVersion')}: {policy.version}</p>}
    <fieldset disabled={busy || !policy || !canEdit} className="policy-options">
      <label><input type="checkbox" checked disabled /> IN_PROGRESS</label>
      <label><input type="checkbox" checked={ready} onChange={event => setReady(event.target.checked)} /> READY</label>
      <label><input type="checkbox" checked={inSetup} onChange={event => setInSetup(event.target.checked)} /> IN_SETUP</label>
      {canEdit && <Button disabled={busy || !policy} onClick={() => void save()}>{t('materialIssue.save')}</Button>}
    </fieldset>
    <Button disabled={busy} onClick={() => setReload(value => value + 1)}>{t('materialIssue.refresh')}</Button>
    {canEdit && <MaterialIssueDecisionDraft key={`${userId}:${orgId}`} orgId={orgId} userId={userId} />}
  </section>
}
