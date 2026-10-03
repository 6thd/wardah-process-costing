import { PREPARE_KEY, RESERVE_KEY, RELEASE_KEY } from './materialIssuePreparation'
import { CONSUME_KEY, uuid } from './materialIssueOptions'

const reads = ['manufacturing.orders.read', 'manufacturing.work_centers.read', 'manufacturing.stages.read', 'inventory.items.read']
const prepare = [...reads, PREPARE_KEY, 'manufacturing.orders.create', 'manufacturing.orders.update', 'manufacturing.stage_costs.create']
/** Planning profiles only. No automatic grants, templates, or Admin bypass. */
export const materialIssueGrantProfiles = {
  combined: { operator: [...prepare, RESERVE_KEY, RELEASE_KEY, CONSUME_KEY] },
  separated: { preparer: prepare, reservation_keeper: [...reads, RESERVE_KEY, RELEASE_KEY], issuer: [...reads, CONSUME_KEY] },
  supervised: { preparer: [...prepare, RESERVE_KEY], issuer: [...reads, CONSUME_KEY], releaser: [...reads, RELEASE_KEY] },
} as const
export type GrantArrangement = keyof typeof materialIssueGrantProfiles
export type DeviceArrangement = 'designated_workstation' | 'coordinated_devices' | 'server_lease_required'
export function materialIssueDecisionDraft(orgId: string, actorId: string, grants: GrantArrangement,
  devices: DeviceArrangement, riskAcknowledged: boolean) {
  if (!uuid(orgId) || !uuid(actorId) || !Object.prototype.hasOwnProperty.call(materialIssueGrantProfiles, grants)
    || !['designated_workstation', 'coordinated_devices', 'server_lease_required'].includes(devices)
    || !riskAcknowledged) throw new Error('MATERIAL_ISSUE_DECISION_INCOMPLETE')
  return { version: 1, state: 'draft', org_id: orgId, prepared_by: actorId,
    grant_arrangement: grants, proposed_role_keys: materialIssueGrantProfiles[grants],
    device_arrangement: devices, device_control: 'operational_only',
    distinct_event_duplicate_intent_prevented: false,
    server_lease_available: false, release_ready: false,
    owner_acknowledges_cross_device_risk: true,
    prerequisites: ['independent_operator_acceptance', 'explicit_role_grants', 'real_identity_database_reconciliation',
      'issue_278_application_record', 'canonical_migration_signoff', 'separate_release_approval',
      ...(devices === 'server_lease_required' ? ['server_device_lease_implementation_acceptance'] : [])] }
}
