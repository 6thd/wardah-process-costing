import { supabase } from '@/lib/supabase'

export interface SupplierInvoiceCandidate {
  organization_id: string
  vendor_id: string
  vendor: {
    id: string
    code: string
    name: string
  }
  purchase_order_id: string
  purchase_order_number: string
  purchase_order_status: string
  purchase_order_line_id: string
  goods_receipt_id: string
  goods_receipt_number: string
  goods_receipt_status: string
  goods_receipt_line_id: string
  quality_status: string
  product_id: string
  product: {
    id: string
    code: string
    name: string
    name_ar: string | null
  }
  uom_id: string
  uom: {
    id: string
    code: string
    name: string
    name_ar: string | null
    symbol: string | null
    decimal_places: number
  }
  conversion_factor_snapshot: number
  accepted_qty_base: number
  accepted_qty_entered: number
  allocated_qty_base: number
  allocated_qty_entered: number
  remaining_qty_base: number
  remaining_qty_entered: number
  po_unit_price_base: number
  po_unit_price_entered: number
  discount_percentage: number
  tax_percentage: number
}

export interface MatchedSupplierInvoiceLineInput {
  goods_receipt_line_id: string
  quantity_base: number
  unit_price: number
  discount_percentage: number
  tax_percentage: number
}

export interface MatchedSupplierInvoicePayload {
  org_id: string
  vendor_id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  idempotency_key: string
  lines: MatchedSupplierInvoiceLineInput[]
}

export interface MatchedSupplierInvoiceResult {
  success: boolean
  idempotent_replay?: boolean
  invoice_id: string
  invoice_status?: string
  journal_entry_id: string
  journal_status?: string
  subtotal?: number
  tax_amount?: number
  total_amount: number
  idempotency_key?: string
}

export async function listSupplierInvoiceCandidates(input: {
  orgId: string
  vendorId?: string | null
  purchaseOrderId?: string | null
}): Promise<SupplierInvoiceCandidate[]> {
  const { data, error } = await supabase.rpc('rpc_list_supplier_invoice_candidates', {
    p_org_id: input.orgId,
    p_vendor_id: input.vendorId ?? null,
    p_purchase_order_id: input.purchaseOrderId ?? null,
  })

  if (error) throw error
  if (!Array.isArray(data)) {
    throw new Error('AP_CANDIDATE_RESPONSE_INVALID: expected an array response')
  }

  return data as unknown as SupplierInvoiceCandidate[]
}

export async function createMatchedSupplierInvoice(
  payload: MatchedSupplierInvoicePayload,
): Promise<MatchedSupplierInvoiceResult> {
  const { data, error } = await supabase.rpc('rpc_create_matched_supplier_invoice', {
    p_payload: payload,
  })

  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('AP_MATCHED_INVOICE_RESPONSE_INVALID: expected an object response')
  }

  const result = data as unknown as MatchedSupplierInvoiceResult
  if (!result.success || !result.invoice_id || !result.journal_entry_id) {
    throw new Error('AP_MATCHED_INVOICE_RESPONSE_INVALID: atomic result is incomplete')
  }

  return result
}

export function candidateToMatchedLine(
  candidate: SupplierInvoiceCandidate,
): MatchedSupplierInvoiceLineInput {
  return {
    goods_receipt_line_id: candidate.goods_receipt_line_id,
    quantity_base: candidate.remaining_qty_base,
    unit_price: candidate.po_unit_price_base,
    discount_percentage: candidate.discount_percentage,
    tax_percentage: candidate.tax_percentage,
  }
}

export interface StableOperationIdentity {
  fingerprint: string
  key: string
}

export type OperationKeyFactory = () => string

export function stableOperationIdentity(
  fingerprint: string,
  previous: StableOperationIdentity | null,
  createKey: OperationKeyFactory = () => globalThis.crypto.randomUUID(),
): StableOperationIdentity {
  if (previous?.fingerprint === fingerprint) return previous
  return { fingerprint, key: createKey() }
}
