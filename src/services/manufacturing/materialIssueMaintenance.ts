import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase, getEffectiveTenantId, type Database } from '@/lib/supabase'
import { isolatedMaterialIssueEnabled } from '@/features/manufacturing/material-issue/gate'
import { uuid } from './materialIssueOptions'

type Json = Database['public']['Tables']['audit_logs']['Row']['metadata']
/** Candidate protocol overlay; generated canonical database types stay untouched. */
type MaintenanceDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & {
      rpc_manage_material_issue_setup: {
        Args: { p_org_id: string; p_event_id: string; p_command: Json; p_actor_id: string }
        Returns: Json
      }
      rpc_reconcile_material_issue_setup: {
        Args: { p_org_id: string; p_event_id: string; p_command: Json; p_actor_id: string }
        Returns: Json
      }
    }
  }
}
export interface MaintenanceCommand {
  operation: 'create_order' | 'set_order_status' | 'create_work_order' | 'set_work_order_status'
    | 'open_stage_wip' | 'reserve' | 'resize_reservation' | 'release_reservation'
  [key: string]: unknown
}
interface Pending {
  key: string; eventId: string; orgId: string; actorId: string; command: MaintenanceCommand
  attempts: { id: string; state: 'unknown' | 'rejected' }[]
  attemptId?: string
}
export interface MaintenancePorts {
  enabled(): boolean
  identity(): Promise<{ orgId: string; actorId: string }>
  post(record: Pending): Promise<{ data: unknown; error: unknown }>
  reconcile?(record: Pending): Promise<{ data: unknown; error: unknown }>
}
const ports: MaintenancePorts = {
  enabled: isolatedMaterialIssueEnabled,
  async identity() {
    const orgId = await getEffectiveTenantId()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user || !uuid(orgId)) throw new Error('ISSUE_SETUP_IDENTITY_REQUIRED')
    return { orgId, actorId: data.user.id }
  },
  async post(record) {
    const client = supabase as unknown as SupabaseClient<MaintenanceDatabase>
    const result = await client.rpc('rpc_manage_material_issue_setup', {
      p_org_id: record.orgId, p_event_id: record.eventId,
      p_actor_id: record.actorId, p_command: record.command as Json,
    })
    return { data: result.data, error: result.error }
  },
  async reconcile(record) {
    const client = supabase as unknown as SupabaseClient<MaintenanceDatabase>
    const result = await client.rpc('rpc_reconcile_material_issue_setup', {
      p_org_id: record.orgId, p_event_id: record.eventId,
      p_actor_id: record.actorId, p_command: record.command as Json,
    })
    return { data: result.data, error: result.error }
  },
}
function validateScope(command: MaintenanceCommand): void {
  if (command.operation === 'create_order') {
    if (command.mo_id !== undefined) throw new Error('INVALID_ISSUE_SETUP_SCOPE')
  } else if (!['set_order_status', 'create_work_order', 'set_work_order_status', 'open_stage_wip',
    'reserve', 'resize_reservation', 'release_reservation'].includes(command.operation) || !uuid(command.mo_id)) {
    throw new Error('INVALID_ISSUE_SETUP_SCOPE')
  }
}
async function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('ISSUE_SETUP_STORAGE_REQUIRED')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wardah-material-issue-maintenance-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('ISSUE_SETUP_STORAGE_BLOCKED'))
  })
}
async function claim(identity: { orgId: string; actorId: string }, command: MaintenanceCommand): Promise<Pending> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite'); const store = tx.objectStore('pending')
      const key = `${identity.orgId}:${identity.actorId}:${command.mo_id ?? 'create-order'}`
      const request = store.get(key); let record: Pending
      request.onsuccess = () => {
        if (request.result) {
          record = request.result as Pending
          if (JSON.stringify(record.command) !== JSON.stringify(command)) { tx.abort(); return }
        } else {
          record = { key, eventId: crypto.randomUUID(), ...identity, command, attempts: [] }
        }
        record.attemptId = crypto.randomUUID()
        record.attempts.push({ id: record.attemptId, state: 'unknown' })
        store.put(record)
      }
      tx.oncomplete = () => resolve(record)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(new Error('ISSUE_SETUP_PENDING_EVENT_REQUIRES_RECOVERY'))
    })
  } finally { db.close() }
}
async function acknowledge(record: Pending): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite'); const store = tx.objectStore('pending')
      const request = store.get(record.key)
      request.onsuccess = () => { if (request.result?.eventId === record.eventId) store.delete(record.key) }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
async function definiteRejection(record: Pending): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite'); const store = tx.objectStore('pending')
      const request = store.get(record.key)
      request.onsuccess = () => {
        const current = request.result as Pending | undefined
        if (current?.eventId === record.eventId) {
          const attempt = current.attempts.find(a => a.id === record.attemptId)
          if (attempt) attempt.state = 'rejected'
          store.put(current)
        }
      }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
/** Persist before posting. An unknown/denied outcome is retained for explicit recovery. */
export async function manageMaterialIssueSetup(command: MaintenanceCommand, transport: MaintenancePorts = ports): Promise<Record<string, unknown>> {
  if (!transport.enabled()) throw new Error('MATERIAL_ISSUE_RELEASE_HOLD')
  // Clone now; later caller mutation cannot change the saved request or retry.
  const frozen = JSON.parse(JSON.stringify(command)) as MaintenanceCommand
  validateScope(frozen)
  const identity = await transport.identity()
  if (!uuid(identity.orgId) || !uuid(identity.actorId)) throw new Error('ISSUE_SETUP_IDENTITY_REQUIRED')
  const record = await claim(identity, frozen)
  const current = await transport.identity()
  if (current.orgId !== record.orgId || current.actorId !== record.actorId) {
    await definiteRejection(record) // No RPC has been sent for this attempt.
    throw new Error('ISSUE_SETUP_IDENTITY_CHANGED')
  }
  const { data, error } = await transport.post(record)
  if (error) {
    // PostgreSQL statement errors roll back this RPC. Transport/session errors
    // remain unknown. Other attempts for the same event may still be unknown.
    if (object(error) && ['40001', '42501', 'P0001', '22023', '22P02', '23514', '23503', '23505'].includes(String(error.code))) {
      await definiteRejection(record)
    }
    throw error
  }
  const entity = verifiedReceipt(record, data)
  const verifiedIdentity = await transport.identity()
  if (verifiedIdentity.orgId !== record.orgId || verifiedIdentity.actorId !== record.actorId) {
    throw new Error('ISSUE_SETUP_IDENTITY_CHANGED')
  }
  await acknowledge(record)
  return entity
}
function verifiedReceipt(record: Pending, data: unknown): Record<string, unknown> {
  if (!object(data) || data.event_id !== record.eventId || data.org_id !== record.orgId
    || data.operation !== record.command.operation || !object(data.entity) || !uuid(data.entity.id)
    || data.entity.org_id !== record.orgId
    || (!['create_order', 'set_order_status'].includes(record.command.operation) && data.entity.mo_id !== record.command.mo_id)
    || (record.command.operation === 'open_stage_wip' && data.entity.stage_id !== record.command.stage_id)
    || (record.command.operation !== 'open_stage_wip' && (!Number.isSafeInteger(Number(data.entity.maintenance_version)) || Number(data.entity.maintenance_version) < 1))
    || (record.command.operation === 'set_order_status' && data.entity.id !== record.command.mo_id)
    || (record.command.operation === 'set_work_order_status' && data.entity.id !== record.command.work_order_id)
    || (['resize_reservation', 'release_reservation'].includes(record.command.operation) && data.entity.id !== record.command.reservation_id)) {
    throw new Error('ISSUE_SETUP_RESULT_UNVERIFIED')
  }
  return data.entity
}

/** Clear only after ALL registered attempts were definitely rejected. */
export async function acknowledgeRejectedMaterialIssueSetup(moId?: string, transport: MaintenancePorts = ports): Promise<void> {
  if (!transport.enabled()) throw new Error('MATERIAL_ISSUE_RELEASE_HOLD')
  const identity = await transport.identity(); const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite'); const store = tx.objectStore('pending')
      const key = `${identity.orgId}:${identity.actorId}:${moId ?? 'create-order'}`
      const request = store.get(key)
      request.onsuccess = () => {
        const record = request.result as Pending | undefined
        if (!record || !record.attempts.length || record.attempts.some(a => a.state !== 'rejected')) { tx.abort(); return }
        store.delete(key)
      }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(new Error('ISSUE_SETUP_OUTCOME_UNRESOLVED'))
    })
  } finally { db.close() }
}

/** Explicit recovery reads the immutable pending command, rather than rebuilding it. */
export async function recoverMaterialIssueSetup(moId?: string, transport: MaintenancePorts = ports): Promise<Record<string, unknown>> {
  if (!transport.enabled()) throw new Error('MATERIAL_ISSUE_RELEASE_HOLD')
  const identity = await transport.identity(); const db = await database()
  const record = await new Promise<Pending | undefined>((resolve, reject) => {
    const tx = db.transaction('pending', 'readonly')
    const request = tx.objectStore('pending').get(`${identity.orgId}:${identity.actorId}:${moId ?? 'create-order'}`)
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  }).finally(() => db.close())
  if (!record) throw new Error('ISSUE_SETUP_NO_PENDING_EVENT')
  return manageMaterialIssueSetup(record.command, transport)
}

/** Enumerate durable events for this identity, independent of MO age/eligibility. */
export async function listPendingMaterialIssueSetup(transport: MaintenancePorts = ports): Promise<{ eventId: string; moId?: string; operation: string }[]> {
  if (!transport.enabled()) throw new Error('MATERIAL_ISSUE_RELEASE_HOLD')
  const identity = await transport.identity(); const db = await database()
  const records = await new Promise<Pending[]>((resolve, reject) => {
    const tx = db.transaction('pending', 'readonly'); const request = tx.objectStore('pending').getAll()
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  }).finally(() => db.close())
  const current = await transport.identity()
  if (current.orgId !== identity.orgId || current.actorId !== identity.actorId) throw new Error('ISSUE_SETUP_IDENTITY_CHANGED')
  return records.filter(r => r.orgId === identity.orgId && r.actorId === identity.actorId)
    .map(r => ({ eventId: r.eventId, moId: uuid(r.command.mo_id) ? r.command.mo_id : undefined, operation: r.command.operation }))
}

/** Server lock + durable fence, never a client inference from a missing receipt. */
export async function reconcileMaterialIssueSetup(moId?: string, transport: MaintenancePorts = ports): Promise<'applied' | 'closed'> {
  if (!transport.enabled()) throw new Error('MATERIAL_ISSUE_RELEASE_HOLD')
  const identity = await transport.identity(); const db = await database()
  const record = await new Promise<Pending | undefined>((resolve, reject) => {
    const tx = db.transaction('pending', 'readonly')
    const request = tx.objectStore('pending').get(`${identity.orgId}:${identity.actorId}:${moId ?? 'create-order'}`)
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  }).finally(() => db.close())
  if (!record) throw new Error('ISSUE_SETUP_NO_PENDING_EVENT')
  // Legacy malformed WIP records are reconciled in their saved slot too; the
  // server closes their exact event rather than executing an invalid command.
  const current = await transport.identity()
  if (current.orgId !== record.orgId || current.actorId !== record.actorId) throw new Error('ISSUE_SETUP_IDENTITY_CHANGED')
  if (!transport.reconcile) throw new Error('ISSUE_SETUP_RECONCILIATION_UNAVAILABLE')
  const { data, error } = await transport.reconcile(record)
  if (error) throw error
  if (!object(data) || data.event_id !== record.eventId || data.org_id !== record.orgId
    || data.actor_id !== record.actorId || data.operation !== record.command.operation
    || !['applied', 'closed'].includes(String(data.state))) throw new Error('ISSUE_SETUP_RESULT_UNVERIFIED')
  if (data.state === 'applied') verifiedReceipt(record, data.receipt)
  else if (data.receipt !== null) throw new Error('ISSUE_SETUP_RESULT_UNVERIFIED')
  const verifiedIdentity = await transport.identity()
  if (verifiedIdentity.orgId !== record.orgId || verifiedIdentity.actorId !== record.actorId) throw new Error('ISSUE_SETUP_IDENTITY_CHANGED')
  await acknowledge(record) // Compare-delete: a newer event can never be cleared.
  return data.state as 'applied' | 'closed'
}

/** Read-only scoped version snapshot; the RPC checks it again under the MO lock. */
export async function issueSetupSnapshot(table: 'manufacturing_orders' | 'work_orders' | 'material_reservations', id: string): Promise<Record<string, unknown>> {
  if (!isolatedMaterialIssueEnabled()) throw new Error('MATERIAL_ISSUE_RELEASE_HOLD')
  const identity = await ports.identity()
  const { data, error } = await (supabase as unknown as SupabaseClient).from(table)
    .select('*').eq('id', id).eq('org_id', identity.orgId).single()
  if (error) throw error
  if (!data || !Number.isSafeInteger(Number(data.maintenance_version)) || Number(data.maintenance_version) < 1) {
    throw new Error('ISSUE_SETUP_VERSION_REQUIRED')
  }
  return data as Record<string, unknown>
}
