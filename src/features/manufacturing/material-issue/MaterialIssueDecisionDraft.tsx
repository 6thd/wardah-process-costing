import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { materialIssueDecisionDraft, type GrantArrangement, type DeviceArrangement } from '@/services/manufacturing/materialIssueReleaseDecisions'

/** A reviewable decision proposal. Export never changes permissions or release state. */
export function MaterialIssueDecisionDraft({ orgId, userId }: { orgId: string; userId: string }) {
  const { t } = useTranslation()
  const [grants, setGrants] = useState<GrantArrangement | ''>('')
  const [devices, setDevices] = useState<DeviceArrangement | ''>('')
  const [acknowledged, setAcknowledged] = useState(false)
  let draft = ''
  try { if (grants && devices) draft = JSON.stringify(materialIssueDecisionDraft(orgId, userId, grants, devices, acknowledged), null, 2) } catch { /* Incomplete choice. */ }
  return <fieldset className="space-y-3 rounded-md border p-4">
    <legend>{t('materialIssue.decisionTitle')}</legend>
    <p>{t('materialIssue.decisionDraftNotice')}</p>
    <label>{t('materialIssue.grantArrangement')}<select aria-label={t('materialIssue.grantArrangement')}
      value={grants} onChange={event => { setGrants(event.target.value as GrantArrangement); setAcknowledged(false) }}>
      <option value="">{t('materialIssue.choose')}</option>
      {(['combined', 'separated', 'supervised'] as const).map(value => <option key={value} value={value}>{t(`materialIssue.grants_${value}`)}</option>)}
    </select></label>
    <label>{t('materialIssue.deviceArrangement')}<select aria-label={t('materialIssue.deviceArrangement')}
      value={devices} onChange={event => { setDevices(event.target.value as DeviceArrangement); setAcknowledged(false) }}>
      <option value="">{t('materialIssue.choose')}</option>
      {(['designated_workstation', 'coordinated_devices', 'server_lease_required'] as const).map(value => <option key={value} value={value}>{t(`materialIssue.devices_${value}`)}</option>)}
    </select></label>
    <p>{t('materialIssue.crossDeviceRisk')}</p>
    {devices === 'designated_workstation' && <p>{t('materialIssue.workstationHandover')}</p>}
    {devices === 'server_lease_required' && <p role="status">{t('materialIssue.leaseUnavailable')}</p>}
    <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />{t('materialIssue.acknowledgeDecisionRisk')}</label>
    {draft && <>
      <pre className="overflow-auto text-xs">{draft}</pre>
      <a className="underline" href={`data:application/json;charset=utf-8,${encodeURIComponent(draft)}`}
        download="wardah-material-issue-decision.json">{t('materialIssue.exportDecisionDraft')}</a>
    </>}
  </fieldset>
}
