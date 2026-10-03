import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeRejectedMaterialIssueSetup, manageMaterialIssueSetup, recoverMaterialIssueSetup, issueSetupSnapshot,
  reconcileMaterialIssueSetup, listPendingMaterialIssueSetup, type MaintenanceCommand, type MaintenancePorts,
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
  it.each(['set_order_status', 'create_work_order', 'set_work_order_status', 'open_stage_wip', 'reserve', 'resize_reservation', 'release_reservation'] as const)(
    'rejects missing MO for %s before a claim or transport', async operation => {
      const p = ports()
      await expect(manageMaterialIssueSetup({ operation }, p)).rejects.toThrow('INVALID_ISSUE_SETUP_SCOPE')
      expect(p.post).not.toHaveBeenCalled()
      expect(await listPendingMaterialIssueSetup(p)).toEqual([])
    })
  it('rejects invalid MO and mis-scoped creation before persistence', async () => {
    const p = ports()
    await expect(manageMaterialIssueSetup({ ...command(), mo_id: 'bad' }, p)).rejects.toThrow('INVALID_ISSUE_SETUP_SCOPE')
    await expect(manageMaterialIssueSetup({ operation: 'create_order', mo_id: mo }, p)).rejects.toThrow('INVALID_ISSUE_SETUP_SCOPE')
    expect(await listPendingMaterialIssueSetup(p)).toEqual([])
  })
  async function unknown(p: MaintenancePorts) {
    p.post = vi.fn(async () => { throw new Error('lost response') })
    await expect(manageMaterialIssueSetup(command(), p)).rejects.toThrow('lost response')
  }
  function closed(p: MaintenancePorts) {
    p.reconcile = vi.fn(async r => ({ data: { event_id: r.eventId, org_id: r.orgId, actor_id: r.actorId,
      operation: r.command.operation, state: 'closed', receipt: null }, error: null }))
  }
  it('resolves unknown -> definite denial only with a verified server fence, allowing new intent', async () => {
    const p = ports(); await unknown(p)
    p.post = vi.fn(async () => ({ data: null, error: { code: '40001', message: 'ISSUE_SETUP_STALE_VERSION' } }))
    await expect(recoverMaterialIssueSetup(mo, p)).rejects.toMatchObject({ code: '40001' })
    await expect(acknowledgeRejectedMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_OUTCOME_UNRESOLVED')
    await expect(manageMaterialIssueSetup({ ...command(), status: 'on_hold' }, p)).rejects.toThrow('ISSUE_SETUP_PENDING_EVENT_REQUIRES_RECOVERY')
    closed(p)
    expect(await reconcileMaterialIssueSetup(mo, p)).toBe('closed')
    expect(await listPendingMaterialIssueSetup(p)).toEqual([])
    p.post = ports().post
    await manageMaterialIssueSetup({ ...command(), status: 'on_hold' }, p)
  })
  it('retrieves and verifies the applied receipt without reposting a command', async () => {
    const p = ports(); const success = p.post; await unknown(p)
    p.reconcile = vi.fn(async r => ({ data: { event_id: r.eventId, org_id: r.orgId, actor_id: r.actorId,
      operation: r.command.operation, state: 'applied', receipt: (await success(r)).data }, error: null }))
    expect(await reconcileMaterialIssueSetup(mo, p)).toBe('applied')
    expect(p.post).toHaveBeenCalledTimes(1)
    expect(await listPendingMaterialIssueSetup(p)).toEqual([])
  })
  it.each(['event_id', 'org_id', 'actor_id', 'operation', 'state', 'receipt'])(
    'retains pending state when reconciliation %s is unverified', async field => {
      const p = ports(); await unknown(p); closed(p); const correct = p.reconcile!
      p.reconcile = vi.fn(async r => { const result = await correct(r); return { data: { ...(result.data as object), [field]: 'bad' }, error: null } })
      await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_RESULT_UNVERIFIED')
      expect(await listPendingMaterialIssueSetup(p)).toHaveLength(1)
    })
  it('retains a malformed applied receipt', async () => {
    const p = ports(); await unknown(p); closed(p); const correct = p.reconcile!
    p.reconcile = vi.fn(async r => ({ data: { ...((await correct(r)).data as object), state: 'applied', receipt: {} }, error: null }))
    await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_RESULT_UNVERIFIED')
    expect(await listPendingMaterialIssueSetup(p)).toHaveLength(1)
  })
  it('fails closed on reconciliation permission denial or unavailable protocol', async () => {
    const p = ports(); await unknown(p)
    await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_RECONCILIATION_UNAVAILABLE')
    p.reconcile = vi.fn(async () => ({ data: null, error: { code: '42501' } }))
    await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toMatchObject({ code: '42501' })
    expect(await listPendingMaterialIssueSetup(p)).toHaveLength(1)
  })
  it.each(['before', 'after'])('retains the record on identity change %s reconciliation', async phase => {
    const p = ports(); await unknown(p); closed(p)
    vi.mocked(p.identity).mockResolvedValueOnce({ orgId, actorId })
    if (phase === 'after') vi.mocked(p.identity).mockResolvedValueOnce({ orgId, actorId })
    vi.mocked(p.identity).mockResolvedValueOnce({ orgId, actorId: 'ed000000-0000-4000-8000-0000000000a3' })
    await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_IDENTITY_CHANGED')
    expect(p.reconcile).toHaveBeenCalledTimes(phase === 'after' ? 1 : 0)
    expect(await listPendingMaterialIssueSetup(p)).toHaveLength(1)
  })
  it('holds reconciliation and listing in production and requires a saved record', async () => {
    const p = ports(); p.enabled = () => false
    await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toThrow('MATERIAL_ISSUE_RELEASE_HOLD')
    await expect(listPendingMaterialIssueSetup(p)).rejects.toThrow('MATERIAL_ISSUE_RELEASE_HOLD')
    p.enabled = () => true
    await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_NO_PENDING_EVENT')
  })
  it('lists only own actor/org pending events, including creation and recent MOs', async () => {
    const p = ports(); await unknown(p)
    await expect(manageMaterialIssueSetup({ operation: 'create_order', order: {} }, p)).rejects.toThrow('lost response')
    expect(await listPendingMaterialIssueSetup(p)).toEqual([
      expect.objectContaining({ moId: undefined, operation: 'create_order' }),
      expect.objectContaining({ moId: mo, operation: 'set_order_status' }),
    ])
    p.identity = vi.fn(async () => ({ orgId, actorId: 'ed000000-0000-4000-8000-0000000000a3' }))
    expect(await listPendingMaterialIssueSetup(p)).toEqual([])
    p.identity = vi.fn(async () => ({ orgId: 'ed000000-0000-4000-8000-000000000002', actorId }))
    expect(await listPendingMaterialIssueSetup(p)).toEqual([])
  })
  it('never publishes a pending list for a changed identity', async () => {
    const p = ports(); await unknown(p)
    vi.mocked(p.identity).mockResolvedValueOnce({ orgId, actorId }).mockResolvedValueOnce({ orgId, actorId: 'ed000000-0000-4000-8000-0000000000a3' })
    await expect(listPendingMaterialIssueSetup(p)).rejects.toThrow('ISSUE_SETUP_IDENTITY_CHANGED')
  })
  it('uses the default reconciliation RPC with the immutable event and actor', async () => {
    vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
    defaults.tenant.mockResolvedValue(orgId); defaults.user.mockResolvedValue({ data: { user: { id: actorId } }, error: null })
    defaults.rpc.mockRejectedValueOnce(new Error('lost response'))
    await expect(manageMaterialIssueSetup(command())).rejects.toThrow('lost response')
    const original = defaults.rpc.mock.calls.at(-1)![1]
    defaults.rpc.mockImplementationOnce(async (_name, args) => ({ data: { event_id: args.p_event_id,
      org_id: args.p_org_id, actor_id: args.p_actor_id, operation: args.p_command.operation, state: 'closed', receipt: null }, error: null }))
    expect(await reconcileMaterialIssueSetup(mo)).toBe('closed')
    expect(defaults.rpc).toHaveBeenLastCalledWith('rpc_reconcile_material_issue_setup', original)
  })
  it('a late reconciliation result cannot clear a newer event in the same MO slot', async () => {
    const p = ports(); await unknown(p); closed(p); const response = p.reconcile!
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    let captured!: () => void
    const started = new Promise<void>(resolve => { captured = resolve })
    p.reconcile = vi.fn(async r => { captured(); await wait; return response(r) })
    const late = reconcileMaterialIssueSetup(mo, p); await started
    p.reconcile = response; await reconcileMaterialIssueSetup(mo, p)
    await expect(manageMaterialIssueSetup({ ...command(), status: 'on_hold' }, p)).rejects.toThrow('lost response')
    const newer = await listPendingMaterialIssueSetup(p)
    release(); await late
    expect(await listPendingMaterialIssueSetup(p)).toEqual(newer)
    await expect(acknowledgeRejectedMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_OUTCOME_UNRESOLVED')
  })
  it('retains pending data if local acknowledgement fails after a verified server fence', async () => {
    const p = ports(); await unknown(p); closed(p); const response = p.reconcile!
    let restore!: () => void
    p.reconcile = vi.fn(async r => {
      const result = await response(r)
      const storage = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('storage failed') })
      restore = () => storage.mockRestore()
      return result
    })
    await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toThrow('storage failed')
    restore()
    expect(await listPendingMaterialIssueSetup(p)).toHaveLength(1)
    p.reconcile = response
    expect(await reconcileMaterialIssueSetup(mo, p)).toBe('closed')
  })
  it('fails closed on absent storage before reconciliation or listing', async () => {
    const p = ports(); vi.stubGlobal('indexedDB', undefined)
    await expect(reconcileMaterialIssueSetup(mo, p)).rejects.toThrow('ISSUE_SETUP_STORAGE_REQUIRED')
    await expect(listPendingMaterialIssueSetup(p)).rejects.toThrow('ISSUE_SETUP_STORAGE_REQUIRED')
  })
})
