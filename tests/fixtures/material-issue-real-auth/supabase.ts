import { createClient } from '@supabase/supabase-js'
export const orgId = 'ed000000-0000-4000-8000-000000000001'
export const getEffectiveTenantId = async () => orgId
export const getTenantId = getEffectiveTenantId
// Vendor Auth and PostgREST, using a generated LOCAL anon key. No service key reaches the browser.
const testFetch: typeof fetch = async (input, init) => {
  if (String(input).endsWith('/rpc/rpc_manage_material_issue_setup') && localStorage.getItem('operator:drop-setup-before-call') === 'true') {
    localStorage.removeItem('operator:drop-setup-before-call'); throw new Error('LOCAL_LOST_BEFORE_SEND')
  }
  const response = await fetch(input, init)
  if (String(input).endsWith('/rpc/rpc_consume_material_event') && response.ok
    && localStorage.getItem('operator:lose-issue') === 'true') {
    localStorage.removeItem('operator:lose-issue'); throw new Error('LOCAL_COMMIT_THEN_LOST_RESPONSE')
  }
  return response
}
export const supabase = createClient(`${location.origin}/local-supabase`, import.meta.env.VITE_LOCAL_ANON_KEY,
  { global: { fetch: testFetch }, auth: { persistSession: true, autoRefreshToken: false } })
export const getSupabase = () => supabase
