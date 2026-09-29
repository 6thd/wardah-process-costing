import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '@/lib/supabase'
import {
  acknowledgeRejectedMaterialIssue, claimMaterialIssue, pendingMaterialIssue,
  sendMaterialIssue, getMaterialIssuePolicy, setMaterialIssuePolicy, type MaterialIssueCommand,
} from '../materialIssueClient'

let activeUser = ''
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: vi.fn(), auth: { getUser: vi.fn(async () => ({ data: { user: { id: activeUser } }, error: null })) },
} }))

let sequence = 0
function command(): MaterialIssueCommand {
  sequence++
  activeUser = `user-${sequence}`
  return {
    userId: `user-${sequence}`, orgId: 'org-1', moId: `mo-${sequence}`, stageId: 'stage-1',
    lines: [{ item_id: 'item-1', reservation_id: 'reservation-1', warehouse_id: 'bin-1',
      work_order_id: 'wo-1', uom_id: 'uom-1', quantity: 1.25, consumption_type: 'MANUAL' }],
  }
}

beforeEach(() => vi.mocked(supabase.rpc).mockReset())

describe('material issue durable slot', () => {
  it('allocates one event across competing tabs and preserves the ordered request', async () => {
    const input = command()
    const results = await Promise.allSettled([claimMaterialIssue(input), claimMaterialIssue(input)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const saved = await pendingMaterialIssue(input.userId, input.moId)
    expect(saved?.lines).toEqual(input.lines)
    expect(saved?.attempts).toEqual([{ state: 'unknown', registered: false }])
    expect(saved?.eventId).toBeTruthy()
  })

  it('keeps a lost response unresolved after a later permission denial', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'MATERIAL_CONSUMPTION_PERMISSION_DENIED' } } as never)
    await expect(sendMaterialIssue(record.eventId)).rejects.toThrow('network timeout')
    await expect(sendMaterialIssue(record.eventId)).rejects.toMatchObject({ code: 'P0001' })
    await expect(acknowledgeRejectedMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_OUTCOME_UNKNOWN')
    await expect(claimMaterialIssue(input)).rejects.toThrow('MATERIAL_ISSUE_UNRESOLVED')
    expect((await pendingMaterialIssue(input.userId, input.moId))?.attempts).toMatchObject([
      { state: 'unknown', registered: true }, { state: 'rejected', registered: true },
    ])
  })

  it('tombstones a definitive rejection and refuses a stale tab retry', async () => {
    const input = command()
    const first = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null, error: { code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION' },
    } as never)
    await expect(sendMaterialIssue(first.eventId)).rejects.toMatchObject({ code: 'P0001' })
    await acknowledgeRejectedMaterialIssue(first.eventId)
    await expect(sendMaterialIssue(first.eventId)).rejects.toThrow('MATERIAL_ISSUE_EVENT_TERMINAL')
    const corrected = await claimMaterialIssue(input)
    expect(corrected.eventId).not.toBe(first.eventId)
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('replays with the same event and returns the committed receipt after reload', async () => {
    const input = command()
    const first = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce({
      error: null,
      data: { success: true, event_id: first.eventId, mo_id: input.moId,
        org_id: input.orgId, stage_id: input.stageId, consumption_ids: ['row-1'],
        consumption_count: 1, material_cost_posted: 3 },
    } as never)
    await expect(sendMaterialIssue(first.eventId)).rejects.toThrow('lost reply')
    const recovered = await pendingMaterialIssue(input.userId, input.moId)
    expect(recovered?.eventId).toBe(first.eventId)
    expect((await sendMaterialIssue(recovered!.eventId)).event_id).toBe(first.eventId)
    expect(await pendingMaterialIssue(input.userId, input.moId)).toBeNull()
    expect(vi.mocked(supabase.rpc).mock.calls.map(([, args]) => (args as { p_consumptions: unknown }).p_consumptions)).toEqual([input.lines, input.lines])
  })

  it('rejects partial policy reads and sends only a canonical settings array', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { allowed_statuses: ['IN_PROGRESS'] }, error: null } as never)
    await expect(getMaterialIssuePolicy('org-1')).rejects.toThrow('MATERIAL_ISSUE_POLICY_INVALID')
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: {
      org_id: 'org-1', allowed_statuses: ['IN_PROGRESS', 'READY', 'IN_SETUP'], version: 2,
    }, error: null } as never)
    expect((await setMaterialIssuePolicy('org-1', true, true)).version).toBe(2)
    expect(supabase.rpc).toHaveBeenLastCalledWith('rpc_set_material_issue_wo_statuses', {
      p_org_id: 'org-1', p_allowed_statuses: ['IN_PROGRESS', 'READY', 'IN_SETUP'],
    })
  })

  it('blocks a different signed-in actor before sending an old event', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    activeUser = 'another-user'
    await expect(sendMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_ACTOR_CHANGED')
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect((await pendingMaterialIssue(input.userId, input.moId))?.attempts[0].registered).toBe(false)
  })
})
