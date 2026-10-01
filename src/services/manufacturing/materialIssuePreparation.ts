import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase, getEffectiveTenantId } from '@/lib/supabase'
import { isolatedMaterialIssueEnabled } from '@/features/manufacturing/material-issue/gate'
import { uuid } from './materialIssueOptions'
import type { MaintenanceCommand } from './materialIssueMaintenance'

export const PREPARE_KEY = 'manufacturing.material_issue_setup.prepare'
export const RESERVE_KEY = 'manufacturing.material_reservation.reserve'
export const RELEASE_KEY = 'manufacturing.material_reservation.release'
export type PreparationTable = 'manufacturing_orders' | 'work_orders' | 'material_reservations'
  | 'products' | 'items' | 'work_centers' | 'manufacturing_stages'
export interface PreparationRow {
  id: string; org_id: string; [key: string]: unknown
}
export interface PreparationCatalog {
  manufacturing_orders: PreparationRow[]; work_orders: PreparationRow[]; material_reservations: PreparationRow[]
  products: PreparationRow[]; items: PreparationRow[]; work_centers: PreparationRow[]; manufacturing_stages: PreparationRow[]
}
const tables: PreparationTable[] = ['manufacturing_orders', 'work_orders', 'material_reservations',
  'products', 'items', 'work_centers', 'manufacturing_stages']
export const preparationKeys = (operation: MaintenanceCommand['operation']): string[] => {
  if (operation === 'reserve' || operation === 'resize_reservation') return [RESERVE_KEY]
  if (operation === 'release_reservation') return [RELEASE_KEY]
  if (operation === 'create_order') return [PREPARE_KEY, 'manufacturing.orders.create']
  if (operation === 'set_order_status') return [PREPARE_KEY, 'manufacturing.orders.update']
  if (operation === 'open_stage_wip') return [PREPARE_KEY, 'manufacturing.stage_costs.create']
  return [PREPARE_KEY]
}
/** Existing org-scoped SELECTs only. Writes continue through the frozen candidate RPC. */
export async function getPreparationCatalog(orgId: string, actorId: string): Promise<PreparationCatalog> {
  if (!isolatedMaterialIssueEnabled()) throw new Error('MATERIAL_ISSUE_RELEASE_HOLD')
  const identity = async () => {
    const tenant = await getEffectiveTenantId()
    const { data, error } = await supabase.auth.getUser()
    if (error || tenant !== orgId || data.user?.id !== actorId || !uuid(orgId) || !uuid(actorId)) {
      throw new Error('ISSUE_SETUP_IDENTITY_CHANGED')
    }
  }
  await identity()
  const client = supabase as unknown as SupabaseClient
  const entries = await Promise.all(tables.map(async table => {
    const rows: PreparationRow[] = []; const seen = new Set<string>(); let after = ''
    for (;;) {
      let query = client.from(table).select('*').eq('org_id', orgId).order('id', { ascending: true })
      if (after) query = query.gt('id', after)
      const { data, error } = await query.limit(500)
      if (error) throw error
      if (!Array.isArray(data) || new Set(data.map(row => row?.id)).size !== data.length
        || data.some(row => !row || !uuid(row.id) || row.org_id !== orgId || seen.has(row.id))) {
        throw new Error('ISSUE_SETUP_CATALOG_UNVERIFIED')
      }
      for (const row of data) {
        const id = row.id.toLowerCase()
        if (id <= after) throw new Error('ISSUE_SETUP_CATALOG_UNVERIFIED')
        after = id; seen.add(row.id); rows.push(row as PreparationRow)
      }
      // A hosted row cap may be below 500. Only an empty page ends the scan.
      if (data.length === 0) break
    }
    return [table, rows] as const
  }))
  await identity()
  return Object.fromEntries(entries) as unknown as PreparationCatalog
}
export interface PreparationUnit { org_id: string; item_id: string; product_id: string; uom_id: string }
export async function getPreparationReservationUnit(orgId: string, itemId: string, actorId: string): Promise<PreparationUnit> {
  if (!isolatedMaterialIssueEnabled()) throw new Error('MATERIAL_ISSUE_RELEASE_HOLD')
  if (!uuid(orgId) || !uuid(itemId) || !uuid(actorId)) throw new Error('INVALID_ISSUE_SETUP_SCOPE')
  const identity = async () => {
    const tenant = await getEffectiveTenantId(); const { data, error } = await supabase.auth.getUser()
    if (error || tenant !== orgId || data.user?.id !== actorId) throw new Error('ISSUE_SETUP_IDENTITY_CHANGED')
  }
  await identity()
  const client = supabase as unknown as SupabaseClient
  const { data, error } = await client.rpc('rpc_get_material_reservation_setup', { p_org_id: orgId, p_item_id: itemId })
  await identity()
  if (error) throw error
  if (!data || data.org_id !== orgId || data.item_id !== itemId || !uuid(data.product_id) || !uuid(data.uom_id)) {
    throw new Error('ISSUE_SETUP_RESULT_UNVERIFIED')
  }
  return data as PreparationUnit
}
export function preparationQuantity(text: string, digits = 6, upper = 1_000_000_000_000): number {
  const value = Number(text)
  const [whole, fraction = ''] = text.split('.')
  const tail = fraction.replace(/0+$/, '')
  const canonical = whole.replace(/^0+(?=\d)/, '') + (tail ? `.${tail}` : '')
  const pattern = digits === 4 ? /^\d+(\.\d{1,4})?$/ : /^\d+(\.\d{1,6})?$/
  if (![4, 6].includes(digits) || !pattern.test(text) || !Number.isFinite(value)
    || value <= 0 || value >= upper || String(value) !== canonical || Number(value.toFixed(digits)) !== value) {
    throw new Error('INVALID_BASE_QUANTITY')
  }
  return value
}
function version(row: PreparationRow): number {
  const value = Number(row.maintenance_version)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('ISSUE_SETUP_VERSION_REQUIRED')
  return value
}
export function reservationBalance(row: PreparationRow): number {
  const values = [row.quantity_reserved, row.quantity_consumed ?? 0, row.quantity_released ?? 0].map(Number)
  if (values.some(value => !Number.isFinite(value) || value < 0) || values[0] < values[1] + values[2]) {
    throw new Error('ISSUE_SETUP_RESERVATION_HISTORY_INVALID')
  }
  return values[0] - values[1] - values[2]
}
export function resizePreparationReservation(row: PreparationRow, product: PreparationRow, text: string): MaintenanceCommand {
  if (!uuid(row.mo_id) || row.org_id !== product.org_id || row.product_id !== product.id
    || row.status !== 'reserved' || row.uom_id !== product.base_uom_id || Number(row.conversion_factor_snapshot) !== 1
    || Number(row.quantity_consumed ?? 0) !== 0 || Number(row.quantity_released ?? 0) !== 0
    || (row.expires_at && !(Date.parse(String(row.expires_at)) > Date.now()))) {
    throw new Error('ISSUE_SETUP_HISTORICAL_RESERVATION_IMMUTABLE')
  }
  reservationBalance(row)
  return { operation: 'resize_reservation', mo_id: row.mo_id, reservation_id: row.id,
    quantity: preparationQuantity(text), expected_version: version(row) }
}
export function releasePreparationReservation(row: PreparationRow, text: string): MaintenanceCommand {
  const quantity = preparationQuantity(text)
  if (!uuid(row.mo_id) || row.status !== 'reserved' || quantity > reservationBalance(row)) {
    throw new Error('RELEASE_EXCEEDS_RESERVATION')
  }
  return { operation: 'release_reservation', mo_id: row.mo_id, reservation_id: row.id,
    quantity, expected_version: version(row) }
}
/** Expected version is the displayed snapshot, not a fresh read that hides a stale draft. */
export function preparationStatus(row: PreparationRow, status: string, workOrder = false): MaintenanceCommand {
  if (workOrder) {
    if (!uuid(row.mo_id) || !['READY', 'IN_SETUP', 'IN_PROGRESS', 'ON_HOLD'].includes(status)) throw new Error('INVALID_ISSUE_SETUP_SCOPE')
    return { operation: 'set_work_order_status', mo_id: row.mo_id, work_order_id: row.id, status, expected_version: version(row) }
  }
  if (!['confirmed', 'in_progress', 'on_hold'].includes(status)) throw new Error('INVALID_ISSUE_SETUP_SCOPE')
  return { operation: 'set_order_status', mo_id: row.id, status, expected_version: version(row) }
}
