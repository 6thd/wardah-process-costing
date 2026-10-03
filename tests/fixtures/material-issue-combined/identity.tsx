import { useSyncExternalStore } from 'react'
import { ids } from '../material-issue-browser/identity'
export { ids }
const allKeys = ['manufacturing.material_consumption.consume', 'manufacturing.material_issue_setup.prepare',
  'manufacturing.material_reservation.reserve', 'manufacturing.material_reservation.release',
  'manufacturing.orders.create', 'manufacturing.orders.update', 'manufacturing.stage_costs.create']
export let identity = { user: ids.user, org: ids.org, keys: allKeys, admin: false }
const listeners = new Set<() => void>()
export function changeIdentity(keys: string[]) { identity = { ...identity, keys }; listeners.forEach(fn => fn()) }
function useIdentity() { return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => identity) }
export function useAuth() { const value = useIdentity(); return { user: { id: value.user }, currentOrgId: value.org, loading: false } }
export function usePermissions() { const value = useIdentity(); return { loading: false, error: null, isOrgAdmin: value.admin,
 permissionIdentityKey: `${value.user}:${value.org}`, hasPermissionKey: (key: string) => value.keys.includes(key) } }
