import { describe, expect, it } from 'vitest'
import { materialIssueGrantProfiles, materialIssueDecisionDraft, type GrantArrangement, type DeviceArrangement } from '../materialIssueReleaseDecisions'
const org = 'ed000000-0000-4000-8000-000000000001', actor = 'ed000000-0000-4000-8000-0000000000a2'
describe('owner decision proposals', () => {
  it.each(['combined', 'separated', 'supervised'] as GrantArrangement[])('exports exact %s grants with release held', profile => {
    const draft = materialIssueDecisionDraft(org, actor, profile, 'designated_workstation', true)
    expect(draft.proposed_role_keys).toEqual(materialIssueGrantProfiles[profile]); expect(draft.state).toBe('draft')
    expect(draft.release_ready).toBe(false); expect(draft.distinct_event_duplicate_intent_prevented).toBe(false)
    expect(JSON.stringify(draft)).not.toContain('*')
    expect(draft.prerequisites).toContain('issue_278_application_record')
  })
  it('separates issuer, keeper and preparer without admin/template bypass', () => {
    expect(materialIssueGrantProfiles.separated.issuer).not.toContain('manufacturing.material_reservation.release')
    expect(materialIssueGrantProfiles.separated.reservation_keeper).not.toContain('manufacturing.material_consumption.consume')
    expect(materialIssueGrantProfiles.supervised.preparer).not.toContain('manufacturing.material_reservation.release')
  })
  it.each(['designated_workstation', 'coordinated_devices', 'server_lease_required'] as DeviceArrangement[])('states operational limits for %s', devices => {
    const draft = materialIssueDecisionDraft(org, actor, 'combined', devices, true)
    expect(draft.device_control).toBe('operational_only'); expect(draft.server_lease_available).toBe(false)
    expect(draft.prerequisites.includes('server_device_lease_implementation_acceptance')).toBe(devices === 'server_lease_required')
  })
  it.each(['missing_ack', 'actor', 'org', 'profile', 'devices'])('rejects incomplete %s choice', part => {
    expect(() => materialIssueDecisionDraft(part === 'org' ? '' : org, part === 'actor' ? '' : actor,
      (part === 'profile' ? '__proto__' : 'combined') as GrantArrangement,
      (part === 'devices' ? '' : 'coordinated_devices') as DeviceArrangement, part !== 'missing_ack')).toThrow()
  })
})
