// Test transport only: real PG functions, fixed simulated identity, no live Auth.
import { identity } from './identity'
export const getEffectiveTenantId = async () => identity.org
export const getTenantId = getEffectiveTenantId
const call = async (body: unknown) => {
  const result = await fetch('/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!result.ok) throw new Error('DISPOSABLE_BRIDGE_FAILED')
  return result.json()
}
export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: identity.user } }, error: null }) },
  async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'rpc_manage_material_issue_setup' && localStorage.getItem('operator:drop-setup-before-call') === 'true') {
      localStorage.removeItem('operator:drop-setup-before-call'); throw new Error('LOCAL_LOST_BEFORE_SEND')
    }
    const result = await call({ kind: 'rpc', name, args })
    if (name === 'rpc_consume_material_event' && localStorage.getItem('operator:lose-issue') === 'true' && !result.error) {
      localStorage.removeItem('operator:lose-issue'); throw new Error('LOCAL_COMMIT_THEN_LOST_RESPONSE')
    }
    if (name === 'rpc_manage_material_issue_setup' && localStorage.getItem('operator:lose-setup-after-commit') === 'true' && !result.error) {
      localStorage.removeItem('operator:lose-setup-after-commit'); throw new Error('LOCAL_COMMIT_THEN_LOST_RESPONSE')
    }
    return result
  },
  from(table: string) {
    let id = ''; let org = ''; let after: string | null = null
    const query = { select: (_columns: string) => query,
      eq: (key: string, value: string) => { if (key === 'id') id = value; if (key === 'org_id') org = value; return query },
      single: () => call({ kind: 'read', table, id }),
      order: (_column: string) => query,
      gt: (column: string, value: string) => { if (column !== 'id') throw new Error('UNREVIEWED_FIXTURE_READ'); after = value; return query },
      limit: (size: number) => call({ kind: 'catalog', table, org, after, limit: size }) }
    return query
  },
}
export const getSupabase = () => supabase
