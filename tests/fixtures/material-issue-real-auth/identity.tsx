import { useSyncExternalStore } from 'react'
import { supabase, orgId } from './supabase'
let identity = { user: '', org: orgId, keys: [] as string[], admin: false, loading: true, error: null as Error | null }
const listeners = new Set<() => void>()
let generation = 0
const notify = () => listeners.forEach(fn => fn())
export async function refreshIdentity() {
  const request = ++generation
  identity = { ...identity, loading: true, keys: [], admin: false }; notify()
  const { data, error } = await supabase.auth.getUser()
  if (request !== generation) return
  if (error || !data.user) { identity = { ...identity, user: '', loading: false, error: null }; notify(); return }
  const result = await supabase.rpc('rpc_permission_snapshot', { p_org_id: orgId })
  if (request !== generation) return
  const snapshot = result.data
  const verified = !result.error && snapshot?.user_id === data.user.id && snapshot?.org_id === orgId && Array.isArray(snapshot.permission_keys)
  identity = { user: data.user.id, org: orgId, keys: verified ? snapshot.permission_keys : [],
    admin: verified && snapshot.is_org_admin === true, loading: false, error: verified ? null : new Error('LOCAL_PERMISSION_SNAPSHOT_UNVERIFIED') }; notify()
}
supabase.auth.onAuthStateChange(() => { queueMicrotask(() => { void refreshIdentity() }) })
function useIdentity() { return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => identity) }
export function useAuth() { const value = useIdentity(); return { user: value.user ? { id: value.user } : null, currentOrgId: value.org, loading: value.loading } }
export function usePermissions() { const value = useIdentity(); return { loading: value.loading, error: value.error, isOrgAdmin: value.admin,
  permissionIdentityKey: `${value.user}:${value.org}`, hasPermissionKey: (key: string) => value.keys.includes(key) } }
