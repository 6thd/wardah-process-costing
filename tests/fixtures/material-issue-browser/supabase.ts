// Local simulation ONLY. No Supabase client, network, credentials or live data.
import { identity, ids } from './identity'
import { maintenanceRpc } from './maintenance-transport'
export const getEffectiveTenantId = async () => identity.org
const read = <T,>(key: string, fallback: T): T => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback))
export const supabase = { auth: { getUser: async () => ({ data: { user: { id: identity.user } }, error: null }) },
 rpc: async (name: string, args: Record<string, unknown>) => {
 const trace = read<unknown[]>('fixture:trace', []); trace.push({ name, args, actor: identity.user }); localStorage.setItem('fixture:trace', JSON.stringify(trace))
 const setup = maintenanceRpc(name, args)
 if (setup) return setup
 const policy = read('fixture:policy', { org_id: identity.org, version: 1, allowed_statuses: ['IN_PROGRESS'] })
 if (name === 'rpc_get_material_issue_wo_statuses') return { data: policy, error: null }
 if (name === 'rpc_set_material_issue_wo_statuses') {
  if (!identity.admin) return { data: null, error: { code: 'P0001', message: 'ORG_ADMIN_REQUIRED' } }
  const next = { org_id: identity.org, version: policy.version + 1, allowed_statuses: args.p_allowed_statuses }
  localStorage.setItem('fixture:policy', JSON.stringify(next)); return { data: next, error: null }
 }
 if (!identity.grant) return { data: null, error: { code: 'P0001', message: 'MATERIAL_CONSUMPTION_PERMISSION_DENIED' } }
 if (name === 'rpc_list_material_issue_orders') return { data: { org_id: identity.org, orders: [{ id: ids.mo, org_id: identity.org, label: 'MO-1' }] }, error: null }
 if (name === 'rpc_get_material_issue_context') return { data: { org_id: identity.org, mo_id: ids.mo,
  stages: [{ id: ids.stage, label: 'Stage 1' }], work_orders: [{ id: ids.wo, label: 'WO-1 — IN_PROGRESS' }],
  reservations: [{ id: ids.reservation, label: 'Raw', item_id: ids.item, product_id: ids.product, uom_id: ids.uom, uom_label: 'KG', remaining: 100 }],
  warehouses: [{ id: ids.warehouse, label: 'Warehouse 1', product_ids: [ids.product] }] }, error: null }
 if (name !== 'rpc_consume_material_event') throw new Error('UNREVIEWED_FIXTURE_RPC')
 const key = `fixture:receipt:${args.p_event_id}`; const previous = read<{ request: string; result: unknown } | null>(key, null)
 const request = JSON.stringify({ actor: identity.user, args })
 if (previous) {
  if (previous.request !== request) return { data: null, error: { code: 'P0001', message: 'MATERIAL_ISSUE_EVENT_CONFLICT' } }
  return { data: previous.result, error: null }
 }
 const result = { success: true, org_id: identity.org, mo_id: ids.mo, stage_id: ids.stage, event_id: args.p_event_id,
  consumption_count: 1, consumption_ids: [ids.reservation], material_cost_posted: 100 }
 localStorage.setItem(key, JSON.stringify({ request, result })); localStorage.setItem('fixture:effects', String(Number(localStorage.getItem('fixture:effects') || 0) + 1))
 if (localStorage.getItem('fixture:lose-next') === 'true') { localStorage.removeItem('fixture:lose-next'); throw new Error('SIMULATED_COMMIT_THEN_LOST_RESPONSE') }
 return { data: result, error: null }
} }
