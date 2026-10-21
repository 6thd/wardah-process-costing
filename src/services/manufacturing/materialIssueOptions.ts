import { supabase } from '@/lib/supabase'
import type { MaterialIssueCommand, MaterialIssueLine } from './materialIssueClient'

export const CONSUME_KEY = 'manufacturing.material_consumption.consume'
export const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
interface Option { id: string; label: string }
export interface IssueOrder extends Option { org_id: string }
export interface IssueReservation extends Option {
  item_id: string; product_id: string; uom_id: string; uom_label: string; remaining: number
}
export interface IssueWarehouse extends Option { product_ids: string[] }
export interface IssueContext {
  org_id: string; mo_id: string; stages: Option[]; work_orders: Option[]
  reservations: IssueReservation[]; warehouses: IssueWarehouse[]
}
export interface IssueDraftLine {
  reservation: string; warehouse: string; workOrder: string; uom: string; quantity: string; notes: string
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function option(value: unknown): value is Option {
  return object(value) && uuid(value.id) && typeof value.label === 'string' && !!value.label
}
function options(value: unknown): value is Option[] {
  return Array.isArray(value) && value.every(option) && new Set(value.map(row => row.id)).size === value.length
}
function invalid(): never { throw new Error('MATERIAL_ISSUE_OPTIONS_INVALID') }
export async function getIssueOrders(orgId: string): Promise<IssueOrder[]> {
  const { data, error } = await supabase.rpc('rpc_list_material_issue_orders', { p_org_id: orgId })
  if (error) throw error
  if (!object(data) || data.org_id !== orgId || !options(data.orders)
    || !data.orders.every(row => object(row) && row.org_id === orgId)) invalid()
  return data.orders as unknown as IssueOrder[]
}
export async function getIssueContext(orgId: string, moId: string): Promise<IssueContext> {
  const { data, error } = await supabase.rpc('rpc_get_material_issue_context', { p_mo_id: moId })
  if (error) throw error
  if (!object(data) || data.org_id !== orgId || data.mo_id !== moId
    || !options(data.stages) || !options(data.work_orders) || !options(data.reservations)
    || !options(data.warehouses)) invalid()
  if (!data.reservations.every(row => object(row) && uuid(row.item_id) && uuid(row.product_id)
    && uuid(row.uom_id) && typeof row.uom_label === 'string' && !!row.uom_label
    && typeof row.remaining === 'number' && Number.isFinite(row.remaining) && row.remaining > 0)
    || !data.warehouses.every(row => object(row) && Array.isArray(row.product_ids)
      && row.product_ids.length > 0 && row.product_ids.every(uuid))) invalid()
  return data as unknown as IssueContext
}
/** Construct only reviewed M192 fields; reject rounding before allocating a durable event. */
export function issueCommand(context: IssueContext, userId: string, stageId: string,
  drafts: IssueDraftLine[]): MaterialIssueCommand {
  if (!uuid(userId) || !uuid(context.org_id) || !uuid(context.mo_id)
    || !context.stages.some(row => row.id === stageId) || !drafts.length) invalid()
  const seen = new Set<string>()
  const lines: MaterialIssueLine[] = drafts.map(draft => {
    const reservation = context.reservations.find(row => row.id === draft.reservation)
    const warehouse = context.warehouses.find(row => row.id === draft.warehouse)
    const quantity = Number(draft.quantity)
    const [whole, fraction = ''] = draft.quantity.split('.')
    const trimmedFraction = fraction.replace(/0+$/, '')
    const canonical = whole.replace(/^0+(?=\d)/, '') + (trimmedFraction ? `.${trimmedFraction}` : '')
    if (!reservation || seen.has(reservation.id) || !warehouse
      || !warehouse.product_ids.includes(reservation.product_id)
      || !context.work_orders.some(row => row.id === draft.workOrder)
      || draft.uom !== reservation.uom_id || !/^\d+(\.\d{1,6})?$/.test(draft.quantity)
      || !Number.isFinite(quantity) || quantity <= 0 || quantity > reservation.remaining
      || quantity >= 1_000_000_000_000 || String(quantity) !== canonical
      || Number(quantity.toFixed(6)) !== quantity) invalid()
    seen.add(reservation.id)
    return { item_id: reservation.item_id, reservation_id: reservation.id,
      warehouse_id: warehouse.id, work_order_id: draft.workOrder, uom_id: draft.uom,
      quantity, consumption_type: 'MANUAL', notes: draft.notes.trim() || null }
  })
  return { orgId: context.org_id, moId: context.mo_id, userId, stageId, lines }
}
