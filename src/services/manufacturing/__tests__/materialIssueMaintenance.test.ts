import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeRejectedMaterialIssueSetup, manageMaterialIssueSetup, recoverMaterialIssueSetup, issueSetupSnapshot,
  type MaintenanceCommand, type MaintenancePorts,
} from '../materialIssueMaintenance'

const defaults = vi.hoisted(() => ({ tenant: vi.fn(), user: vi.fn(), rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getEffectiveTenantId: defaults.tenant, supabase: {
  auth: { getUser: defaults.user }, rpc: defaults.rpc, from: defaults.from,
} }))
const orgId = 'ed000000-0000-4000-8000-000000000001'
const actorId = 'ed000000-0000-4000-8000-0000000000a2'
const mo = 'ed000000-0000-4000-8000-000000000099'
const command = (): MaintenanceCommand => ({ operation: 'set_order_status', mo_id: mo, expected_version: 1, status: 'in_progress' })
function ports(): MaintenancePorts {
  return {
    enabled: () => true,
    identity: vi.fn(async () => ({ orgId, actorId })),
    post: vi.fn(async r => ({ data: { event_id: r.eventId, org_id: r.orgId, operation: r.command.operation,
      entity: { id: mo, org_id: orgId, maintenance_version: 2 } }, error: null })),
  }
}
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('isolated issue maintenance durable events', () => {
  it('posts the persisted actor and event through the default Supabase transport', async () => {
    vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
    defaults.tenant.mockResolvedValue(orgId); defaults.user.mockResolvedValue({ data: { user: { id: actorId } }, error: null })
    defaults.rpc.mockImplementation(async (_name, args) => ({ data: { event_id: args.p_event_id,
      org_id: args.p_org_id, operation: args.p_command.operation, entity: { id: mo, org_id: orgId, maintenance_version: 2 } }, error: null }))
    await manageMaterialIssueSetup(command())
    expect(defaults.rpc).toHaveBeenCalledWith('rpc_manage_material_issue_setup', expect.objectContaining({ p_actor_id: actorId, p_org_id: orgId, p_command: command() }))
  })
  it('rejects absent identity before claiming a default event', async () => {
    vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
    defaults.tenant.mockResolvedValue(orgId); defaults.user.mockResolvedValue({ data: { user: null }, error: null })
    await expect(manageMaterialIssueSetup(command())).rejects.toThrow('ISSUE_SETUP_IDENTITY_REQUIRED')
  })
  it('reads only an org-scoped version and rejects a missing candidate column', async () => {
    vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
    defaults.tenant.mockResolvedValue(orgId); defaults.user.mockResolvedValue({ data: { user: { id: actorId } }, error: null })
    const single = vi.fn().mockResolvedValue({ data: { id: mo, maintenance_version: 7 }, error: null })
    const query = { select: vi.fn(), eq: vi.fn(), single }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); defaults.from.mockReturnValue(query)
    expect(await issueSetupSnapshot('manufacturing_orders', mo)).toMatchObject({ maintenance_version: 7 })
    expect(query.eq).toHaveBeenCalledWith('org_id', orgId)
    single.mockResolvedValue({ data: { id: mo }, error: null })
    await expect(issueSetupSnapshot('manufacturing_orders', mo)).rejects.toThrow('ISSUE_SETUP_VERSION_REQUIRED')
  })
  it('retains the event when identity changes while the RPC is in flight', async () => {
    const p = ports(); vi.mocked(p.identity).mockResolvedValueOnce({ orgId, actorId })
      .mockResolvedValueOnce({ orgId, actorId }).mockResolvedValueOnce({ orgId, actorId: 'ed000000-0000-4000-8000-0000000000a3' })
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('ISSUE_SETUP_IDENTITY_CHANGED')
    await expect(acknowledgeRejectedMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_OUTCOME_UNRESOLVED')
  })

  it('holds production and sends nothing', async () => {
    const p = ports(); p.enabled = () => false
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('MATERIAL_ISSUE_RELEASE_HOLD')
    expect(p.identity).not.toHaveBeenCalled(); expect(p.post).not.toHaveBeenCalled()
  })
  it('requires durable storage before any RPC', async () => {
    vi.stubGlobal('indexedDB', undefined); const p = ports()
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('ISSUE_SETUP_STORAGE_REQUIRED')
    expect(p.post).not.toHaveBeenCalled()
  })
  it('recovers a lost response with exactly the same event and command', async () => {
    const p = ports(); const successful = p.post
    p.post = vi.fn(async r => { await successful(r); throw new Error('lost response') })
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('lost response')
    const first = vi.mocked(p.post).mock.calls[0][0]
    p.post = vi.fn(successful)
    await recoverMaterialIssueSetup(mo, p)
    expect(vi.mocked(p.post).mock.calls[0][0].eventId).toBe(first.eventId)
    expect(vi.mocked(p.post).mock.calls[0][0].command).toEqual(first.command)
    await expect(recoverMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_NO_PENDING_EVENT')
  })
  it('never replaces an unresolved event with a changed command', async () => {
    const p = ports(); p.post = vi.fn(async () => { throw new Error('offline') })
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('offline')
    await expect(manageMaterialIssueSetup({ ...command(), status: 'on_hold' }, p)).rejects.toThrow('ISSUE_SETUP_PENDING_EVENT_REQUIRES_RECOVERY')
    expect(p.post).toHaveBeenCalledTimes(1)
    await expect(acknowledgeRejectedMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_OUTCOME_UNRESOLVED')
  })
  it('clones the caller intent before waiting for identity', async () => {
    const p = ports(); let ready!: () => void
    const wait = new Promise<void>(resolve => { ready = resolve })
    p.identity = vi.fn(async () => { await wait; return { orgId, actorId } })
    const intent = command(); const sending = manageMaterialIssueSetup(intent, p)
    intent.status = 'done'; ready(); await sending
    expect(vi.mocked(p.post).mock.calls[0][0].command.status).toBe('in_progress')
  })
  it('uses one event for concurrent identical tab claims', async () => {
    const p = ports()
    await Promise.all([manageMaterialIssueSetup(command(), p), manageMaterialIssueSetup(command(), p)])
    expect(p.post).toHaveBeenCalledTimes(2)
    expect(vi.mocked(p.post).mock.calls[0][0].eventId).toBe(vi.mocked(p.post).mock.calls[1][0].eventId)
  })
  it('keeps unverified responses unresolved', async () => {
    const p = ports(); p.post = vi.fn(async () => ({ data: { event_id: crypto.randomUUID() }, error: null }))
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('ISSUE_SETUP_RESULT_UNVERIFIED')
    await expect(acknowledgeRejectedMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_OUTCOME_UNRESOLVED')
  })
  it('rechecks identity before posting and records that nothing was sent', async () => {
    const p = ports(); vi.mocked(p.identity).mockResolvedValueOnce({ orgId, actorId })
      .mockResolvedValueOnce({ orgId, actorId: 'ed000000-0000-4000-8000-0000000000a3' })
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('ISSUE_SETUP_IDENTITY_CHANGED')
    expect(p.post).not.toHaveBeenCalled()
    await acknowledgeRejectedMaterialIssueSetup(mo, p)
  })
  it('allows explicit dismissal after every attempt was definitely rejected', async () => {
    const p = ports(); p.post = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }))
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toMatchObject({ code: '42501' })
    await acknowledgeRejectedMaterialIssueSetup(mo, p)
    await expect(recoverMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_NO_PENDING_EVENT')
  })
  it('a later denial cannot dismiss an earlier unknown outcome', async () => {
    const p = ports(); p.post = vi.fn(async () => { throw new Error('lost response') })
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('lost response')
    p.post = vi.fn(async () => ({ data: null, error: { code: '42501' } }))
    await expect(recoverMaterialIssueSetup(mo, p)).rejects.toMatchObject({ code: '42501' })
    await expect(acknowledgeRejectedMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_OUTCOME_UNRESOLVED')
  })
})
