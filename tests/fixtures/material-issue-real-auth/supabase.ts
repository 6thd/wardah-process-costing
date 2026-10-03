import { createClient } from '@supabase/supabase-js'
export const orgId = 'ed000000-0000-4000-8000-000000000001'
export const getEffectiveTenantId = async () => orgId
export const getTenantId = getEffectiveTenantId
// Vendor Auth and PostgREST, using a generated LOCAL anon key. No service key reaches the browser.
export const supabase = createClient(`${location.origin}/local-supabase`, import.meta.env.VITE_LOCAL_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: false } })
export const getSupabase = () => supabase
