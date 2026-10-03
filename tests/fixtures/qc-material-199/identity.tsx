import { useSyncExternalStore } from 'react'
export const org = 'ed000000-0000-4000-8000-000000000001'
export const actor = new URLSearchParams(location.search).get('actor') === 'qc' ? 'qc' : 'material'
export const user = actor === 'qc' ? 'ed000000-0000-4000-8000-0000000000a3' : 'ed000000-0000-4000-8000-0000000000a2'
const keys = ['manufacturing.material_consumption.consume','manufacturing.material_issue_setup.prepare',
 'manufacturing.material_reservation.reserve','manufacturing.material_reservation.release','manufacturing.stages.read']
export const identity = { user, org }
const subscribe = () => () => {}
export function useAuth() { useSyncExternalStore(subscribe, () => user); return { user: { id: user }, currentOrgId: org, loading: false } }
export function usePermissions() { return { loading: false, error: null, isOrgAdmin: false,
 permissionIdentityKey: `${user}:${org}`, hasPermissionKey: (key: string) => keys.includes(key) } }
