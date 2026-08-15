/**
 * Round 8: unit coverage for the actual some()/every() combinators inside
 * hasLiveStageCostingPermission / hasLiveStageCostingPermissionAll — the
 * call-site tests in stage-costing-actions-permissions.test.ts mock these
 * two functions wholesale, so they never exercise the real combinator logic
 * against a mix of granted/denied keys. This file exercises the real
 * implementation, stubbing only the network boundary (checkPermission,
 * Supabase auth, and the effective org id).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermission = vi.fn()
vi.mock('@/hooks/usePermissions', () => ({
  checkPermission: (...args: unknown[]) => checkPermission(...args),
}))

const getUser = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { getUser: (...args: unknown[]) => getUser(...args) } }),
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}))

import { hasLiveStageCostingPermission, hasLiveStageCostingPermissionAll } from '../stage-costing-permissions'

const CREATE = 'manufacturing.stage_costs.create'
const UPDATE = 'manufacturing.stage_costs.update'

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
})

describe('hasLiveStageCostingPermissionAll — every(Boolean), not some(Boolean)', () => {
  it('denies when only the create key is granted (create-only cannot satisfy an UPSERT all-of check)', async () => {
    checkPermission.mockImplementation((_uid: string, _org: string, key: string) => Promise.resolve(key === CREATE))

    const result = await hasLiveStageCostingPermissionAll([CREATE, UPDATE])

    expect(result).toBe(false)
  })

  it('denies when only the update key is granted (update-only cannot satisfy an UPSERT all-of check)', async () => {
    checkPermission.mockImplementation((_uid: string, _org: string, key: string) => Promise.resolve(key === UPDATE))

    const result = await hasLiveStageCostingPermissionAll([CREATE, UPDATE])

    expect(result).toBe(false)
  })

  it('grants only when both create and update are held', async () => {
    checkPermission.mockResolvedValue(true)

    const result = await hasLiveStageCostingPermissionAll([CREATE, UPDATE])

    expect(result).toBe(true)
    expect(checkPermission).toHaveBeenCalledWith('user-1', 'org-1', CREATE)
    expect(checkPermission).toHaveBeenCalledWith('user-1', 'org-1', UPDATE)
  })

  it('fails closed when the session cannot be read', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    checkPermission.mockResolvedValue(true)

    const result = await hasLiveStageCostingPermissionAll([CREATE, UPDATE])

    expect(result).toBe(false)
  })
})

describe('hasLiveStageCostingPermission — some(Boolean), unchanged for single-key/any-of call sites', () => {
  it('grants when at least one of several keys is held', async () => {
    checkPermission.mockImplementation((_uid: string, _org: string, key: string) => Promise.resolve(key === CREATE))

    const result = await hasLiveStageCostingPermission([CREATE, UPDATE])

    expect(result).toBe(true)
  })

  it('denies when none of the keys are held', async () => {
    checkPermission.mockResolvedValue(false)

    const result = await hasLiveStageCostingPermission([CREATE, UPDATE])

    expect(result).toBe(false)
  })
})
