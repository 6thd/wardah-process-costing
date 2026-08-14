// src/features/manufacturing/stage-costing-permissions.ts
// بسم الله الرحمن الرحيم
//
// StageCostingPanel registers its live-write actions on the GLOBAL uiEvents
// singleton (src/ui/events.js), not as React event handlers scoped to the
// mounted component. That means `data-action="apply-labor-time"` (etc.) is a
// standing, app-wide trigger for the rest of the session — hiding the button
// or unmounting the panel does not unregister it, and the 60s usePermissions()
// cache the React tree reads from can be stale relative to a revocation that
// just happened in another tab or another admin action.
//
// hasLiveStageCostingPermission() exists to close that gap: it asks the
// backend's has_permission() RPC directly (via checkPermission(), which never
// reads the client-side cache) immediately before a write actually executes,
// so a mid-session revocation is honored on the very next click even though
// nothing forced the panel to re-render.

import { getSupabase, getEffectiveTenantId } from '@/lib/supabase'
import { checkPermission } from '@/hooks/usePermissions'

export const STAGE_COSTING_PERMISSIONS = {
  ORDERS_READ: 'manufacturing.orders.read',
  STAGES_READ: 'manufacturing.stages.read',
  WORK_CENTERS_READ: 'manufacturing.work_centers.read',
  STAGE_COSTS_READ: 'manufacturing.stage_costs.read',
  STAGE_COSTS_CREATE: 'manufacturing.stage_costs.create',
  STAGE_COSTS_UPDATE: 'manufacturing.stage_costs.update',
} as const

/**
 * Live (uncached) permission check against the backend. Returns true if the
 * currently signed-in user holds ANY of the given keys for their current
 * organization. Fails closed (false) on any missing session, org, or error —
 * an unreadable answer must never be treated as a grant.
 */
export async function hasLiveStageCostingPermission(
  keys: string | readonly string[]
): Promise<boolean> {
  const list = Array.isArray(keys) ? keys : [keys as string]
  if (list.length === 0) return false

  try {
    const supabase = getSupabase()
    if (!supabase) return false

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user?.id) return false

    const orgId = await getEffectiveTenantId()
    if (!orgId) return false

    const results = await Promise.all(
      list.map((key) => checkPermission(userData.user.id, orgId, key))
    )
    return results.some(Boolean)
  } catch (error) {
    console.error('hasLiveStageCostingPermission failed closed:', error)
    return false
  }
}
