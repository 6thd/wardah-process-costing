// Simulated RPC journal only; PG17 acceptance independently proves server locking.
import { identity } from './identity'
export function maintenanceRpc(name: string, args: Record<string, unknown>) {
  if (!['rpc_manage_material_issue_setup', 'rpc_reconcile_material_issue_setup'].includes(name)) return undefined
  if (!identity.prepare || args.p_actor_id !== identity.user || args.p_org_id !== identity.org) {
    return { data: null, error: { code: '42501', message: 'ISSUE_MAINTENANCE_PERMISSION_DENIED' } }
  }
  const command = args.p_command as Record<string, unknown>
  const key = `fixture:setup:${args.p_org_id}:${args.p_event_id}`
  const saved = JSON.parse(localStorage.getItem(key) || 'null')
  if (name === 'rpc_reconcile_material_issue_setup') {
    if (!saved) localStorage.setItem(key, JSON.stringify({ state: 'closed', receipt: null }))
    return { data: { event_id: args.p_event_id, org_id: args.p_org_id, actor_id: args.p_actor_id,
      operation: command.operation, state: saved?.state || 'closed', receipt: saved?.receipt || null }, error: null }
  }
  if (saved?.state === 'closed') return { data: null, error: { code: 'P0001', message: 'ISSUE_SETUP_EVENT_CLOSED' } }
  if (saved) return { data: saved.receipt, error: null }
  const mode = localStorage.getItem('fixture:setup-mode')
  if (mode === 'lost-before') throw new Error('SIMULATED_UNKNOWN_TRANSPORT')
  if (mode === 'denied') return { data: null, error: { code: '40001', message: 'ISSUE_SETUP_STALE_VERSION' } }
  const receipt = { event_id: args.p_event_id, org_id: args.p_org_id, operation: command.operation,
    entity: { id: command.mo_id, org_id: args.p_org_id, maintenance_version: 2 } }
  localStorage.setItem(key, JSON.stringify({ state: 'applied', receipt }))
  if (mode === 'lost-after') throw new Error('SIMULATED_COMMIT_THEN_LOST_RESPONSE')
  return { data: receipt, error: null }
}
