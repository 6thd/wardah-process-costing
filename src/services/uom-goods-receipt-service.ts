import { supabase as _supabase } from '@/lib/supabase'
import type { GoodsReceiptLine } from '@/services/purchasing-service'

const supabase = _supabase as import('@supabase/supabase-js').SupabaseClient

export type ReceiptQualityStatus = 'accepted' | 'rejected'

export interface ReceivableVendorSnapshot {
  id: string
  code?: string | null
  name: string
}

export interface ReceivableProductSnapshot {
  code?: string | null
  name?: string | null
  name_ar?: string | null
}

export interface ReceivableUomSnapshot {
  id: string
  code?: string | null
  name?: string | null
  name_ar?: string | null
  symbol?: string | null
  decimal_places?: number | null
}

export interface ReceivablePurchaseOrderLine {
  id: string
  line_number: number
  product_id: string
  product: ReceivableProductSnapshot
  uom_id: string
  uom: ReceivableUomSnapshot
  conversion_factor_snapshot: number
  ordered_qty_entered: number
  ordered_qty_base: number
  received_qty_entered: number
  received_qty_base: number
  accepted_qty_base: number
  rejected_qty_base: number
  pending_qty_base: number
  remaining_qty_entered: number
  remaining_qty_base: number
  unit_cost_entered: number
  unit_cost_base: number
}

export interface ReceivablePurchaseOrder {
  id: string
  order_number: string
  vendor_id: string
  vendor: ReceivableVendorSnapshot
  order_date: string
  expected_delivery_date?: string | null
  status: 'approved' | 'partially_received'
  total_amount: number
  lines: ReceivablePurchaseOrderLine[]
}

export interface ReceiptDraftLine extends ReceivablePurchaseOrderLine {
  is_selected: boolean
  receipt_qty_entered: number
  quality_status: ReceiptQualityStatus
}

export interface PostUomGoodsReceiptInput {
  orgId: string
  purchaseOrder: ReceivablePurchaseOrder
  warehouseId: string
  receiptDate: string
  notes?: string
  lines: ReceiptDraftLine[]
  idempotencyKey: string
}

export interface PostUomGoodsReceiptResult {
  success: true
  goods_receipt_id: string
  receipt_number?: string
  total_value?: number
  lines_processed?: number
  idempotent_replay?: boolean
  inventory_atomic?: boolean
  uom_atomic?: boolean
  po_snapshot_atomic?: boolean
  quality_aware_contract?: boolean
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeLine(value: Record<string, unknown>): ReceivablePurchaseOrderLine {
  const uom = (value.uom ?? {}) as Record<string, unknown>
  const product = (value.product ?? {}) as Record<string, unknown>
  const factor = toFiniteNumber(value.conversion_factor_snapshot, 1)

  if (!value.id || !value.product_id || !value.uom_id || factor <= 0) {
    throw new Error('RECEIVABLE_PO_LINE_CONTRACT_INVALID')
  }

  return {
    id: String(value.id),
    line_number: toFiniteNumber(value.line_number),
    product_id: String(value.product_id),
    product: {
      code: product.code == null ? null : String(product.code),
      name: product.name == null ? null : String(product.name),
      name_ar: product.name_ar == null ? null : String(product.name_ar),
    },
    uom_id: String(value.uom_id),
    uom: {
      id: String(uom.id ?? value.uom_id),
      code: uom.code == null ? null : String(uom.code),
      name: uom.name == null ? null : String(uom.name),
      name_ar: uom.name_ar == null ? null : String(uom.name_ar),
      symbol: uom.symbol == null ? null : String(uom.symbol),
      decimal_places: uom.decimal_places == null ? null : toFiniteNumber(uom.decimal_places),
    },
    conversion_factor_snapshot: factor,
    ordered_qty_entered: toFiniteNumber(value.ordered_qty_entered),
    ordered_qty_base: toFiniteNumber(value.ordered_qty_base),
    received_qty_entered: toFiniteNumber(value.received_qty_entered),
    received_qty_base: toFiniteNumber(value.received_qty_base),
    accepted_qty_base: toFiniteNumber(value.accepted_qty_base),
    rejected_qty_base: toFiniteNumber(value.rejected_qty_base),
    pending_qty_base: toFiniteNumber(value.pending_qty_base),
    remaining_qty_entered: toFiniteNumber(value.remaining_qty_entered),
    remaining_qty_base: toFiniteNumber(value.remaining_qty_base),
    unit_cost_entered: toFiniteNumber(value.unit_cost_entered),
    unit_cost_base: toFiniteNumber(value.unit_cost_base),
  }
}

function normalizeOrder(value: Record<string, unknown>): ReceivablePurchaseOrder {
  const vendor = (value.vendor ?? {}) as Record<string, unknown>
  const status = String(value.status)
  if (!value.id || !value.vendor_id || !value.order_number || !['approved', 'partially_received'].includes(status)) {
    throw new Error('RECEIVABLE_PO_CONTRACT_INVALID')
  }

  return {
    id: String(value.id),
    order_number: String(value.order_number),
    vendor_id: String(value.vendor_id),
    vendor: {
      id: String(vendor.id ?? value.vendor_id),
      code: vendor.code == null ? null : String(vendor.code),
      name: String(vendor.name ?? ''),
    },
    order_date: String(value.order_date),
    expected_delivery_date:
      value.expected_delivery_date == null ? null : String(value.expected_delivery_date),
    status: status as ReceivablePurchaseOrder['status'],
    total_amount: toFiniteNumber(value.total_amount),
    lines: Array.isArray(value.lines)
      ? value.lines.map((line) => normalizeLine(line as Record<string, unknown>))
      : [],
  }
}

export async function listUomReceivablePurchaseOrders(
  orgId: string,
): Promise<ReceivablePurchaseOrder[]> {
  if (!orgId) throw new Error('ORG_ID_REQUIRED')

  const { data, error } = await supabase.rpc('rpc_list_uom_receivable_purchase_orders', {
    p_org_id: orgId,
  })

  if (error) throw error
  if (!Array.isArray(data)) throw new Error('RECEIVABLE_PO_RESPONSE_INVALID')

  return data.map((order) => normalizeOrder(order as Record<string, unknown>))
}

export function validateReceiptQuantity(quantity: number, remaining: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('RECEIPT_QUANTITY_MUST_BE_POSITIVE')
  }
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new Error('NO_OPEN_QUANTITY')
  }
  if (quantity - remaining > 0.000001) {
    throw new Error('RECEIPT_QUANTITY_EXCEEDS_OPEN_BALANCE')
  }
}

export function createReceiptDraftLine(line: ReceivablePurchaseOrderLine): ReceiptDraftLine {
  return {
    ...line,
    is_selected: line.remaining_qty_entered > 0,
    receipt_qty_entered: line.remaining_qty_entered,
    quality_status: 'accepted',
  }
}

export function buildGoodsReceiptLine(line: ReceiptDraftLine): GoodsReceiptLine {
  validateReceiptQuantity(line.receipt_qty_entered, line.remaining_qty_entered)

  const baseQuantity = Math.round(
    line.receipt_qty_entered * line.conversion_factor_snapshot * 1_000_000,
  ) / 1_000_000

  return {
    product_id: line.product_id,
    purchase_order_line_id: line.id,
    ordered_quantity: line.ordered_qty_base,
    received_quantity: baseQuantity,
    unit_cost: line.unit_cost_base,
    quality_status: line.quality_status,
    uom_id: line.uom_id,
    qty_entered: line.receipt_qty_entered,
    unit_cost_entered: line.unit_cost_entered,
  }
}

export async function postUomGoodsReceipt(
  input: PostUomGoodsReceiptInput,
): Promise<PostUomGoodsReceiptResult> {
  if (!input.orgId) throw new Error('ORG_ID_REQUIRED')
  if (!input.warehouseId) throw new Error('WAREHOUSE_REQUIRED')
  if (!input.idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED')

  const selectedLines = input.lines.filter((line) => line.is_selected)
  if (selectedLines.length === 0) throw new Error('RECEIPT_LINES_REQUIRED')

  const lines = selectedLines.map(buildGoodsReceiptLine)
  const { data, error } = await supabase.rpc('rpc_post_goods_receipt', {
    p_payload: {
      tenant_id: input.orgId,
      idempotency_key: input.idempotencyKey,
      vendor_id: input.purchaseOrder.vendor_id,
      purchase_order_id: input.purchaseOrder.id,
      receipt_date: input.receiptDate,
      warehouse_id: input.warehouseId,
      notes: input.notes || null,
      lines: lines.map((line) => ({
        product_id: line.product_id,
        purchase_order_line_id: line.purchase_order_line_id,
        ordered_quantity: line.ordered_quantity,
        received_quantity: line.received_quantity,
        unit_cost: line.unit_cost,
        quality_status: line.quality_status,
        uom_id: line.uom_id,
        qty_entered: line.qty_entered,
        unit_cost_entered: line.unit_cost_entered,
      })),
    },
  })

  if (error) throw error
  const result = data as Partial<PostUomGoodsReceiptResult> | null
  if (!result?.success || !result.goods_receipt_id) {
    throw new Error('GOODS_RECEIPT_RPC_INVALID_RESPONSE')
  }

  if (result.inventory_atomic !== true || result.uom_atomic !== true || result.po_snapshot_atomic !== true) {
    throw new Error('GOODS_RECEIPT_ATOMIC_CONTRACT_MISSING')
  }

  return result as PostUomGoodsReceiptResult
}
