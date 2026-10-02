import { useSyncExternalStore } from 'react'
export const ids = { org: 'ed000000-0000-4000-8000-000000000001', user: 'ed000000-0000-4000-8000-0000000000a2',
 mo: 'ed000000-0000-4000-8000-000000000010', stage: 'ed000000-0000-4000-8000-0000000000f1',
 wo: 'ed000000-0000-4000-8000-000000000020', reservation: 'ed000000-0000-4000-8000-000000000030',
 item: 'ed000000-0000-4000-8000-0000000000d1', product: 'ed000000-0000-4000-8000-0000000000c1',
 warehouse: 'ed000000-0000-4000-8000-0000000000e1', uom: 'ed000000-0000-4000-8000-000000000040' }
export let identity = { user: ids.user, org: ids.org, grant: true, admin: false, prepare: false }
const listeners = new Set<() => void>()
export function changeIdentity(patch: Partial<typeof identity>) { identity = { ...identity, ...patch }; listeners.forEach(fn => fn()) }
function useIdentity() { return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => identity) }
export function useAuth() { const value = useIdentity(); return { user: { id: value.user }, currentOrgId: value.org, loading: false } }
export function usePermissions() { const value = useIdentity(); return { loading: false, error: null, isOrgAdmin: value.admin,
 permissionIdentityKey: `${value.user}:${value.org}`, hasPermissionKey: (key: string) =>
  (value.grant && key === 'manufacturing.material_consumption.consume')
  || (value.prepare && key === 'manufacturing.material_issue_setup.prepare') } }
