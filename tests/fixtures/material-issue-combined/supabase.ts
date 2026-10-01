// Test transport only: real PG functions, fixed simulated identity, no live Auth.
import { identity } from '../material-issue-browser/identity'
export const getEffectiveTenantId = async () => identity.org
export const getTenantId = getEffectiveTenantId
const call = async (body: unknown) => {
  const result = await fetch('http://127.0.0.1:4178/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!result.ok) throw new Error('DISPOSABLE_BRIDGE_FAILED')
  return result.json()
}
export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: identity.user } }, error: null }) },
  async rpc(name: string, args: Record<string, unknown>) {
    const result = await call({ kind: 'rpc', name, args })
    if (name === 'rpc_consume_material_event' && localStorage.getItem('operator:lose-issue') === 'true' && !result.error) {
      localStorage.removeItem('operator:lose-issue'); throw new Error('LOCAL_COMMIT_THEN_LOST_RESPONSE')
    }
    return result
  },
  from(table: string) {
    let id = ''
    const query = { select: (_columns: string) => query,
      eq: (key: string, value: string) => { if (key === 'id') id = value; return query },
      single: () => call({ kind: 'read', table, id }) }
    return query
  },
}
export const getSupabase = () => supabase
