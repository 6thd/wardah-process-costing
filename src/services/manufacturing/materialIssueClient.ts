import { supabase, type Database } from '@/lib/supabase'

/** A browser-local safety boundary. It does not coordinate separate devices. */
export interface MaterialIssueLine {
  item_id: string
  reservation_id: string
  warehouse_id: string
  work_order_id: string
  uom_id: string
  quantity: number
  consumption_type: 'MANUAL'
  notes?: string | null
}

export interface MaterialIssueCommand {
  orgId: string
  userId: string
  moId: string
  stageId: string
  lines: MaterialIssueLine[]
}

interface Attempt {
  state: 'unknown' | 'rejected' | 'succeeded'
  registered: boolean
  code?: string
  message?: string
}

export interface MaterialIssueRecord extends MaterialIssueCommand {
  eventId: string
  slot?: string
  state: 'unresolved' | 'acknowledged' | 'succeeded'
  attempts: Attempt[]
  createdAt: string
  result?: MaterialIssueResult
}

export interface MaterialIssueResult {
  success: true
  org_id: string
  mo_id: string
  stage_id: string
  event_id: string
  consumption_count: number
  consumption_ids: string[]
  material_cost_posted: number
}

const DB_NAME = 'wardah-material-issue-v1'
const STORE = 'events'

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error)
  })
}

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('MATERIAL_ISSUE_STORAGE_UNAVAILABLE')
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1)
    opening.onupgradeneeded = () => {
      const store = opening.result.createObjectStore(STORE, { keyPath: 'eventId' })
      store.createIndex('slot', 'slot', { unique: true })
    }
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error)
    opening.onblocked = () => reject(new Error('MATERIAL_ISSUE_STORAGE_BLOCKED'))
  })
}

/** All reads and writes in callback share one readwrite transaction, serialized across tabs. */
async function change<T>(work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await database()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error || new Error('MATERIAL_ISSUE_STORAGE_ABORTED'))
      tx.onerror = () => reject(tx.error || new Error('MATERIAL_ISSUE_STORAGE_FAILED'))
    })
    try {
      const value = await work(tx.objectStore(STORE))
      await finished
      return value
    } catch (error) {
      try { tx.abort() } catch { /* Already committed or aborted. */ }
      await finished.catch(() => undefined)
      throw error
    }
  } finally {
    db.close()
  }
}

function slot(userId: string, moId: string): string {
  return `${userId}:${moId}`
}

function validate(command: MaterialIssueCommand): void {
  if (![command.orgId, command.userId, command.moId, command.stageId].every(Boolean) || !command.lines.length) {
    throw new Error('MATERIAL_ISSUE_INCOMPLETE')
  }
  const reservations = new Set<string>()
  for (const line of command.lines) {
    if (![line.item_id, line.reservation_id, line.warehouse_id, line.work_order_id, line.uom_id].every(Boolean)
      || line.consumption_type !== 'MANUAL' || typeof line.quantity !== 'number'
      || !Number.isFinite(line.quantity) || line.quantity <= 0
      || !Number.isInteger(line.quantity * 1_000_000)
      || (line.notes != null && typeof line.notes !== 'string')
      || reservations.has(line.reservation_id)) {
      throw new Error('INVALID_MATERIAL_ISSUE_LINE')
    }
    reservations.add(line.reservation_id)
  }
}

function clone(record: MaterialIssueRecord): MaterialIssueRecord {
  return structuredClone(record)
}

export async function claimMaterialIssue(command: MaterialIssueCommand): Promise<MaterialIssueRecord> {
  validate(command)
  const frozen = structuredClone(command)
  const key = slot(frozen.userId, frozen.moId)
  return change(async store => {
    if (await request(store.index('slot').get(key))) throw new Error('MATERIAL_ISSUE_UNRESOLVED')
    const record: MaterialIssueRecord = {
      ...frozen, eventId: crypto.randomUUID(), slot: key, state: 'unresolved',
      // Claim itself is attempt 1: a crash before fetch remains uncertain.
      attempts: [{ state: 'unknown', registered: false }], createdAt: new Date().toISOString(),
    }
    await request(store.add(record))
    return clone(record)
  })
}

export async function pendingMaterialIssue(userId: string, moId: string): Promise<MaterialIssueRecord | null> {
  return change(async store => cloneOrNull(await request<MaterialIssueRecord | undefined>(store.index('slot').get(slot(userId, moId)))))
}

function cloneOrNull(record: MaterialIssueRecord | undefined): MaterialIssueRecord | null {
  return record ? clone(record) : null
}

/** Registration must commit before the network request starts. */
async function register(eventId: string): Promise<{ record: MaterialIssueRecord; attempt: number }> {
  return change(async store => {
    const record = await request<MaterialIssueRecord | undefined>(store.get(eventId))
    if (!record || record.state !== 'unresolved' || !record.slot) throw new Error('MATERIAL_ISSUE_EVENT_TERMINAL')
    const attempt = record.attempts.length === 1 && !record.attempts[0].registered
      ? 0 : record.attempts.push({ state: 'unknown', registered: true }) - 1
    record.attempts[attempt].registered = true
    await request(store.put(record))
    return { record: clone(record), attempt }
  })
}

async function settle(eventId: string, attempt: number, outcome: Attempt, result?: MaterialIssueResult): Promise<void> {
  await change(async store => {
    const record = await request<MaterialIssueRecord | undefined>(store.get(eventId))
    if (!record || record.state !== 'unresolved' || !record.attempts[attempt]) throw new Error('MATERIAL_ISSUE_EVENT_TERMINAL')
    record.attempts[attempt] = outcome
    if (result) {
      record.result = result
      record.state = 'succeeded'
      delete record.slot
    }
    await request(store.put(record))
  })
}

const DEFINITIVE = new Set([
  'INVALID_MATERIAL_ISSUE_LINE', 'INVALID_CONSUMPTION_QUANTITY',
  'WORK_ORDER_NOT_ELIGIBLE_FOR_MATERIAL_ISSUE', 'WORK_ORDER_NOT_FOUND_OR_WRONG_MO',
  'CONSUMPTION_EXCEEDS_RESERVATION', 'MATERIAL_ISSUE_WO_POLICY_INVALID',
  'MATERIAL_CONSUMPTION_PERMISSION_DENIED',
])

function definiteError(error: { code?: string; message?: string }): boolean {
  return error.code === 'P0001' && DEFINITIVE.has(error.message || '')
}

function validResult(value: unknown, record: MaterialIssueRecord): value is MaterialIssueResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<MaterialIssueResult>
  return result.success === true && result.event_id === record.eventId
    && result.mo_id === record.moId && result.stage_id === record.stageId
    && result.org_id === record.orgId && Array.isArray(result.consumption_ids)
    && result.consumption_count === record.lines.length
    && result.consumption_ids.length === record.lines.length
    && Number.isFinite(result.material_cost_posted)
}

export async function sendMaterialIssue(eventId: string): Promise<MaterialIssueResult> {
  // The stored actor is part of M192's fingerprint. A switched login must
  // never retry another user's immutable request.
  const { data: identity, error: identityError } = await supabase.auth.getUser()
  if (identityError || !identity.user) throw new Error('MATERIAL_ISSUE_IDENTITY_UNAVAILABLE')
  const pending = await change(async store => request<MaterialIssueRecord | undefined>(store.get(eventId)))
  if (!pending || pending.userId !== identity.user.id) throw new Error('MATERIAL_ISSUE_ACTOR_CHANGED')
  const { record, attempt } = await register(eventId)
  try {
    const { data, error } = await supabase.rpc('rpc_consume_material_event', {
      p_mo_id: record.moId, p_stage_id: record.stageId, p_event_id: record.eventId,
      p_consumptions: record.lines as unknown as Database['public']['Functions']['rpc_consume_material_event']['Args']['p_consumptions'],
    })
    if (error) {
      await settle(eventId, attempt, definiteError(error)
        ? { state: 'rejected', registered: true, code: error.code, message: error.message }
        : { state: 'unknown', registered: true })
      throw error
    }
    if (!validResult(data, record)) throw new Error('MATERIAL_ISSUE_UNVERIFIED_RESPONSE')
    await settle(eventId, attempt, { state: 'succeeded', registered: true }, data)
    return data
  } catch (error) {
    // No server response, bad response, storage failure: retain the unknown slot.
    throw error
  }
}

/** A definitive first rejection is only dismissible when every registered send was rejected. */
export async function acknowledgeRejectedMaterialIssue(eventId: string): Promise<void> {
  await change(async store => {
    const record = await request<MaterialIssueRecord | undefined>(store.get(eventId))
    if (!record || record.state !== 'unresolved' || !record.attempts.length
      || !record.attempts.every(attempt => attempt.state === 'rejected' && definiteError(attempt))) {
      throw new Error('MATERIAL_ISSUE_OUTCOME_UNKNOWN')
    }
    record.state = 'acknowledged'
    delete record.slot // Keep the event tombstone in the store forever.
    await request(store.put(record))
  })
}

export interface MaterialIssuePolicy {
  org_id: string
  allowed_statuses: Array<'IN_PROGRESS' | 'READY' | 'IN_SETUP'>
  version: number
}

function parsePolicy(value: unknown, orgId: string): MaterialIssuePolicy {
  if (!value || typeof value !== 'object') throw new Error('MATERIAL_ISSUE_POLICY_UNAVAILABLE')
  const policy = value as Partial<MaterialIssuePolicy>
  if (policy.org_id !== orgId || !Number.isInteger(policy.version) || !policy.version
    || !Array.isArray(policy.allowed_statuses) || !policy.allowed_statuses.includes('IN_PROGRESS')
    || policy.allowed_statuses.some(status => !['IN_PROGRESS', 'READY', 'IN_SETUP'].includes(status))
    || new Set(policy.allowed_statuses).size !== policy.allowed_statuses.length) {
    throw new Error('MATERIAL_ISSUE_POLICY_INVALID')
  }
  return policy as MaterialIssuePolicy
}

export async function getMaterialIssuePolicy(orgId: string): Promise<MaterialIssuePolicy> {
  const { data, error } = await supabase.rpc('rpc_get_material_issue_wo_statuses', { p_org_id: orgId })
  if (error) throw error
  return parsePolicy(data, orgId)
}

export async function setMaterialIssuePolicy(orgId: string, ready: boolean, inSetup: boolean): Promise<MaterialIssuePolicy> {
  const statuses = ['IN_PROGRESS', ...(ready ? ['READY'] : []), ...(inSetup ? ['IN_SETUP'] : [])]
  const { data, error } = await supabase.rpc('rpc_set_material_issue_wo_statuses', {
    p_org_id: orgId, p_allowed_statuses: statuses,
  })
  if (error) throw error
  return parsePolicy(data, orgId)
}
