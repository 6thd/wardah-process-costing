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

function issueResult(input: MaterialIssueCommand, eventId: string) {
  return { success: true as const, event_id: eventId, mo_id: input.moId,
    org_id: input.orgId, stage_id: input.stageId, consumption_ids: ['row-1'],
    consumption_count: 1, material_cost_posted: 3 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

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
    await expect(sendMaterialIssue(first.eventId)).rejects.toThrow('MATERIAL_ISSUE_EVENT_ACKNOWLEDGED')
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
    expect(vi.mocked(supabase.rpc).mock.calls.map(([, args]) => ({
      event: (args as { p_event_id: string }).p_event_id,
      lines: (args as { p_consumptions: unknown }).p_consumptions,
    }))).toEqual([{ event: first.eventId, lines: input.lines }, { event: first.eventId, lines: input.lines }])
  })

  it('returns the stored success to a late concurrent response and a stale tab', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    const result = { success: true, event_id: record.eventId, mo_id: input.moId,
      org_id: input.orgId, stage_id: input.stageId, consumption_ids: ['row-1'],
      consumption_count: 1, material_cost_posted: 3 }
    let releaseFirst!: (value: unknown) => void
    let firstStarted!: () => void
    const started = new Promise<void>(resolve => { firstStarted = resolve })
    vi.mocked(supabase.rpc).mockImplementationOnce(() => {
      firstStarted()
      return new Promise(resolve => { releaseFirst = resolve }) as never
    }).mockResolvedValueOnce({ data: result, error: null } as never)
    const first = sendMaterialIssue(record.eventId)
    await started
    const second = sendMaterialIssue(record.eventId)
    expect(await second).toEqual(result)
    releaseFirst({ data: result, error: null })
    expect(await first).toEqual(result)
    expect(await sendMaterialIssue(record.eventId)).toEqual(result)
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('does not acknowledge a rejection while another tab may still return success', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    const late = deferred<{ data: ReturnType<typeof issueResult>; error: null }>()
    const firstStarted = deferred<void>()
    vi.mocked(supabase.rpc).mockImplementationOnce(() => {
      firstStarted.resolve()
      return late.promise as never
    }).mockResolvedValueOnce({ data: null, error: {
      code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION',
    } } as never)

    const first = sendMaterialIssue(record.eventId)
    await firstStarted.promise
    await expect(sendMaterialIssue(record.eventId)).rejects.toMatchObject({ code: 'P0001' })
    await expect(acknowledgeRejectedMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_OUTCOME_UNKNOWN')
    await expect(claimMaterialIssue(input)).rejects.toThrow('MATERIAL_ISSUE_UNRESOLVED')
    late.resolve({ data: issueResult(input, record.eventId), error: null })
    expect(await first).toEqual(issueResult(input, record.eventId))
    await expect(acknowledgeRejectedMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_OUTCOME_UNKNOWN')
    expect(await sendMaterialIssue(record.eventId)).toEqual(issueResult(input, record.eventId))
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('keeps an earlier committed success when a second response is a late rejection', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    const late = deferred<{ data: null; error: { code: string; message: string } }>()
    const secondStarted = deferred<void>()
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: issueResult(input, record.eventId), error: null } as never)
      .mockImplementationOnce(() => {
        secondStarted.resolve()
        return late.promise as never
      })
    // Register the delayed call before the first call resolves.
    const first = sendMaterialIssue(record.eventId)
    const second = sendMaterialIssue(record.eventId)
    await secondStarted.promise
    expect(await first).toEqual(issueResult(input, record.eventId))
    late.resolve({ data: null, error: { code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION' } })
    expect(await second).toEqual(issueResult(input, record.eventId))
    expect(await sendMaterialIssue(record.eventId)).toEqual(issueResult(input, record.eventId))
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('keeps the acknowledgment read and tombstone write in one readwrite transaction', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: {
      code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION',
    } } as never)
    await expect(sendMaterialIssue(record.eventId)).rejects.toMatchObject({ code: 'P0001' })
    const transactions: IDBTransaction[] = []
    // Observe the transaction boundary itself, so a read followed by a write
    // in separate transactions cannot pass merely because the calls ran in order.
    const nativeTransaction = IDBDatabase.prototype.transaction
    const boundary = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = nativeTransaction.apply(this, args as Parameters<IDBDatabase['transaction']>)
      transactions.push(tx)
      return tx
    })
    try {
      await acknowledgeRejectedMaterialIssue(record.eventId)
      expect(transactions).toHaveLength(1)
      expect(transactions[0].mode).toBe('readwrite')
      await expect(sendMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_EVENT_ACKNOWLEDGED')
    } finally {
      boundary.mockRestore()
    }
  })

  it('registers a retry with its fresh slot read in one readwrite transaction before fetch', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    const transactions: IDBTransaction[] = []
    const reads: IDBTransaction[] = []
    const writes: IDBTransaction[] = []
    const nativeTransaction = IDBDatabase.prototype.transaction
    const nativeGet = IDBObjectStore.prototype.get
    const nativePut = IDBObjectStore.prototype.put
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = nativeTransaction.apply(this, args as Parameters<IDBDatabase['transaction']>)
      transactions.push(tx)
      return tx
    })
    const get = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (key === record.eventId) reads.push(this.transaction)
      return nativeGet.call(this, key)
    })
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value) {
      if ((value as { eventId?: string }).eventId === record.eventId) writes.push(this.transaction)
      return nativePut.call(this, value)
    })
    const atNetwork = deferred<void>()
    const server = deferred<{ data: null; error: { code: string; message: string } }>()
    vi.mocked(supabase.rpc).mockImplementationOnce(() => {
      atNetwork.resolve()
      return server.promise as never
    })
    try {
      const sending = sendMaterialIssue(record.eventId)
      await atNetwork.promise
      // One actor/slot lookup and one atomic registration; an extra read
      // transaction before the put may have made the decision on stale data.
      expect(transactions).toHaveLength(2)
      expect(writes).toHaveLength(1)
      expect(writes[0].mode).toBe('readwrite')
      expect(reads).toContain(writes[0])
      server.resolve({ data: null, error: { code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION' } })
      await expect(sending).rejects.toMatchObject({ code: 'P0001' })
    } finally {
      transaction.mockRestore()
      get.mockRestore()
      put.mockRestore()
    }
  })

  it.each(['rejected', 'succeeded'] as const)('settles a %s response with its fresh read and write in one transaction', async outcome => {
    const input = command()
    const record = await claimMaterialIssue(input)
    const atNetwork = deferred<void>()
    const server = deferred<{ data: unknown; error: { code: string; message: string } | null }>()
    vi.mocked(supabase.rpc).mockImplementationOnce(() => {
      atNetwork.resolve()
      return server.promise as never
    })
    const sending = sendMaterialIssue(record.eventId)
    await atNetwork.promise
    const transactions: IDBTransaction[] = []
    const reads: IDBTransaction[] = []
    const writes: IDBTransaction[] = []
    const nativeTransaction = IDBDatabase.prototype.transaction
    const nativeGet = IDBObjectStore.prototype.get
    const nativePut = IDBObjectStore.prototype.put
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = nativeTransaction.apply(this, args as Parameters<IDBDatabase['transaction']>)
      transactions.push(tx)
      return tx
    })
    const get = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (key === record.eventId) reads.push(this.transaction)
      return nativeGet.call(this, key)
    })
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value) {
      if ((value as { eventId?: string }).eventId === record.eventId) writes.push(this.transaction)
      return nativePut.call(this, value)
    })
    try {
      if (outcome === 'succeeded') {
        server.resolve({ data: issueResult(input, record.eventId), error: null })
        expect(await sending).toEqual(issueResult(input, record.eventId))
      } else {
        const error = { code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION' }
        server.resolve({ data: null, error })
        await expect(sending).rejects.toMatchObject(error)
      }
      expect(transactions).toHaveLength(1)
      expect(transactions[0].mode).toBe('readwrite')
      expect(reads).toEqual([transactions[0]])
      expect(writes).toEqual([transactions[0]])
    } finally {
      transaction.mockRestore()
      get.mockRestore()
      put.mockRestore()
    }
  })

  it('blocks an acknowledgment when another tab already registered a retry', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: {
      code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION',
    } } as never)
    await expect(sendMaterialIssue(record.eventId)).rejects.toMatchObject({ code: 'P0001' })
    const atNetwork = deferred<void>()
    const server = deferred<{ data: null; error: { code: string; message: string } }>()
    vi.mocked(supabase.rpc).mockImplementationOnce(() => {
      atNetwork.resolve()
      return server.promise as never
    })
    const retry = sendMaterialIssue(record.eventId)
    await atNetwork.promise
    await expect(acknowledgeRejectedMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_OUTCOME_UNKNOWN')
    await expect(claimMaterialIssue(input)).rejects.toThrow('MATERIAL_ISSUE_UNRESOLVED')
    server.resolve({ data: null, error: { code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION' } })
    await expect(retry).rejects.toMatchObject({ code: 'P0001' })
  })

  it('preserves line order and treats the real Supabase network error shape as unknown', async () => {
    const input = command()
    input.lines.push({ ...input.lines[0], item_id: 'item-2', reservation_id: 'reservation-2', quantity: 1.005 })
    const record = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: {
      code: '', message: 'TypeError: Failed to fetch',
    } } as never).mockResolvedValueOnce({ data: { success: true, event_id: record.eventId,
      mo_id: input.moId, org_id: input.orgId, stage_id: input.stageId,
      consumption_ids: ['row-1', 'row-2'], consumption_count: 2, material_cost_posted: 4 }, error: null } as never)
    await expect(sendMaterialIssue(record.eventId)).rejects.toMatchObject({ code: '' })
    await expect(acknowledgeRejectedMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_OUTCOME_UNKNOWN')
    await sendMaterialIssue(record.eventId)
    expect(vi.mocked(supabase.rpc).mock.calls.map(([, args]) => ({
      event: (args as { p_event_id: string }).p_event_id,
      lines: (args as { p_consumptions: unknown }).p_consumptions,
    }))).toEqual([{ event: record.eventId, lines: input.lines }, { event: record.eventId, lines: input.lines }])
  })

  it('does not acknowledge an event-ID conflict as proof of a failed first attempt', async () => {
    const input = command()
    const record = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: {
      code: 'P0001', message: 'MATERIAL_ISSUE_EVENT_CONFLICT',
    } } as never)
    await expect(sendMaterialIssue(record.eventId)).rejects.toMatchObject({ code: 'P0001' })
    await expect(acknowledgeRejectedMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_OUTCOME_UNKNOWN')
  })

  it('requires both the exact allowlisted message and database SQLSTATE to acknowledge', async () => {
    for (const error of [
      { code: 'PGRST301', message: 'CONSUMPTION_EXCEEDS_RESERVATION' },
      { code: 'P0001', message: 'CONSUMPTION_EXCEEDS_RESERVATION: extra detail' },
      { code: 'P0001', message: 'MATERIAL_ISSUE_EVENT_CONFLICT' },
    ]) {
      const input = command()
      const record = await claimMaterialIssue(input)
      vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error } as never)
      await expect(sendMaterialIssue(record.eventId)).rejects.toMatchObject(error)
      await expect(acknowledgeRejectedMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_OUTCOME_UNKNOWN')
    }
  })

  it.each([
    { event_id: 'other-event' }, { mo_id: 'other-mo' }, { stage_id: 'other-stage' },
    { org_id: 'other-org' }, { consumption_count: 2 },
  ])('rejects a mismatched success response %j without releasing the slot', async difference => {
    const input = command()
    const record = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: {
      success: true, event_id: record.eventId, mo_id: input.moId,
      stage_id: input.stageId, org_id: input.orgId,
      consumption_count: 1, consumption_ids: ['row-1'], material_cost_posted: 3,
      ...difference,
    }, error: null } as never)
    await expect(sendMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_UNVERIFIED_RESPONSE')
    expect((await pendingMaterialIssue(input.userId, input.moId))?.eventId).toBe(record.eventId)
  })

  it.each([
    { success: false }, { consumption_ids: [] }, { consumption_ids: 'row-1' },
    { material_cost_posted: '3' }, { material_cost_posted: NaN },
  ])('rejects a structurally invalid success response %j', async difference => {
    const input = command()
    const record = await claimMaterialIssue(input)
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { ...issueResult(input, record.eventId), ...difference }, error: null,
    } as never)
    await expect(sendMaterialIssue(record.eventId)).rejects.toThrow('MATERIAL_ISSUE_UNVERIFIED_RESPONSE')
    expect((await pendingMaterialIssue(input.userId, input.moId))?.eventId).toBe(record.eventId)
  })

  it('rejects extra keys and accepts decimal quantities that binary multiplication misclassifies', async () => {
    const input = command()
    input.lines[0].quantity = 1.005
    expect((await claimMaterialIssue(input)).lines[0].quantity).toBe(1.005)
    const extra = command()
    Object.assign(extra.lines[0], { unit_cost: 999 })
    await expect(claimMaterialIssue(extra)).rejects.toThrow('INVALID_MATERIAL_ISSUE_LINE')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects a seventh decimal, repeated reservation, and nonpositive quantity before claiming a slot', async () => {
    for (const amend of [
      (input: MaterialIssueCommand) => { input.lines[0].quantity = 1.0000001 },
      (input: MaterialIssueCommand) => { input.lines[0].quantity = 0 },
      (input: MaterialIssueCommand) => { input.lines.push({ ...input.lines[0] }) },
      (input: MaterialIssueCommand) => { input.lines[0].consumption_type = 'BACKFLUSH' as 'MANUAL' },
    ]) {
      const input = command()
      amend(input)
      await expect(claimMaterialIssue(input)).rejects.toThrow('INVALID_MATERIAL_ISSUE_LINE')
      expect(await pendingMaterialIssue(input.userId, input.moId)).toBeNull()
    }
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

  it('rejects invalid independent policy fields and a setter response that disagrees with the request', async () => {
    for (const invalid of [
      { org_id: 'other-org', version: 1, allowed_statuses: ['IN_PROGRESS'] },
      { org_id: 'org-1', version: -1, allowed_statuses: ['IN_PROGRESS'] },
      { org_id: 'org-1', version: 1, allowed_statuses: ['READY', 'IN_PROGRESS'] },
    ]) {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: invalid, error: null } as never)
      await expect(getMaterialIssuePolicy('org-1')).rejects.toThrow('MATERIAL_ISSUE_POLICY_INVALID')
    }
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: {
      org_id: 'org-1', version: 2, allowed_statuses: ['IN_PROGRESS'],
    }, error: null } as never)
    await expect(setMaterialIssuePolicy('org-1', true, false)).rejects.toThrow('MATERIAL_ISSUE_POLICY_MISMATCH')
  })

  it('does not turn a failed policy read into a default write', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: {
      code: 'P0001', message: 'POLICY_READ_DENIED',
    } } as never)
    await expect(getMaterialIssuePolicy('org-1')).rejects.toMatchObject({ code: 'P0001' })
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('rpc_get_material_issue_wo_statuses', { p_org_id: 'org-1' })
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
