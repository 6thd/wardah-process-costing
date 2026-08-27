import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}))

import {
  candidateToMatchedLine,
  createMatchedSupplierInvoice,
  listSupplierInvoiceCandidates,
  stableOperationIdentity,
  type MatchedSupplierInvoicePayload,
  type SupplierInvoiceCandidate,
} from '../supplier-invoice-atomic-service'

const candidate: SupplierInvoiceCandidate = {
  organization_id: 'org-1',
  vendor_id: 'vendor-1',
  vendor: { id: 'vendor-1', code: 'V1', name: 'Vendor One' },
  purchase_order_id: 'po-1',
  purchase_order_number: 'PO-1',
  purchase_order_status: 'fully_received',
  purchase_order_line_id: 'pol-1',
  goods_receipt_id: 'gr-1',
  goods_receipt_number: 'GR-1',
  goods_receipt_status: 'posted',
  goods_receipt_line_id: 'grl-1',
  quality_status: 'accepted',
  product_id: 'product-1',
  product: { id: 'product-1', code: 'P1', name: 'Product One', name_ar: null },
  uom_id: 'uom-1',
  uom: { id: 'uom-1', code: 'KG', name: 'Kilogram', name_ar: 'كيلوجرام', symbol: 'kg', decimal_places: 3 },
  conversion_factor_snapshot: 2,
  accepted_qty_base: 20,
  accepted_qty_entered: 10,
  allocated_qty_base: 6,
  allocated_qty_entered: 3,
  remaining_qty_base: 14,
  remaining_qty_entered: 7,
  po_unit_price_base: 4.75,
  po_unit_price_entered: 9.5,
  discount_percentage: 2,
  tax_percentage: 15,
}

const payload: MatchedSupplierInvoicePayload = {
  org_id: 'org-1',
  vendor_id: 'vendor-1',
  invoice_number: 'INV-100',
  invoice_date: '2026-08-27',
  due_date: null,
  idempotency_key: 'idem-1',
  lines: [{
    goods_receipt_line_id: 'grl-1',
    quantity_base: 14,
    unit_price: 4.75,
    discount_percentage: 2,
    tax_percentage: 15,
  }],
}

describe('supplier-invoice-atomic-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads candidates only through the canonical candidate RPC with explicit filters', async () => {
    rpc.mockResolvedValueOnce({ data: [candidate], error: null })

    await expect(listSupplierInvoiceCandidates({
      orgId: 'org-1',
      vendorId: 'vendor-1',
      purchaseOrderId: 'po-1',
    })).resolves.toEqual([candidate])

    expect(rpc).toHaveBeenCalledWith('rpc_list_supplier_invoice_candidates', {
      p_org_id: 'org-1',
      p_vendor_id: 'vendor-1',
      p_purchase_order_id: 'po-1',
    })
  })

  it('normalizes omitted candidate filters to null', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })

    await listSupplierInvoiceCandidates({ orgId: 'org-1' })

    expect(rpc).toHaveBeenCalledWith('rpc_list_supplier_invoice_candidates', {
      p_org_id: 'org-1',
      p_vendor_id: null,
      p_purchase_order_id: null,
    })
  })

  it('propagates candidate RPC errors and rejects malformed candidate responses', async () => {
    const serverError = new Error('AP_CANDIDATE_PERMISSION_DENIED')
    rpc.mockResolvedValueOnce({ data: null, error: serverError })
    await expect(listSupplierInvoiceCandidates({ orgId: 'org-1' })).rejects.toBe(serverError)

    rpc.mockResolvedValueOnce({ data: { unexpected: true }, error: null })
    await expect(listSupplierInvoiceCandidates({ orgId: 'org-1' }))
      .rejects.toThrow('AP_CANDIDATE_RESPONSE_INVALID')
  })

  it('submits the exact JSON-safe matched payload and returns a complete atomic result', async () => {
    const result = {
      success: true,
      idempotent_replay: false,
      invoice_id: 'invoice-1',
      invoice_status: 'posted',
      journal_entry_id: 'je-1',
      journal_status: 'posted',
      total_amount: 76.48,
      idempotency_key: 'idem-1',
    }
    rpc.mockResolvedValueOnce({ data: result, error: null })

    await expect(createMatchedSupplierInvoice(payload)).resolves.toEqual(result)

    expect(rpc).toHaveBeenCalledWith('rpc_create_matched_supplier_invoice', {
      p_payload: {
        org_id: 'org-1',
        vendor_id: 'vendor-1',
        invoice_number: 'INV-100',
        invoice_date: '2026-08-27',
        due_date: null,
        idempotency_key: 'idem-1',
        lines: [{
          goods_receipt_line_id: 'grl-1',
          quantity_base: 14,
          unit_price: 4.75,
          discount_percentage: 2,
          tax_percentage: 15,
        }],
      },
    })
  })

  it('propagates write RPC errors and rejects malformed or incomplete atomic results', async () => {
    const serverError = new Error('AP_QUANTITY_EXCEEDS_RECEIPT')
    rpc.mockResolvedValueOnce({ data: null, error: serverError })
    await expect(createMatchedSupplierInvoice(payload)).rejects.toBe(serverError)

    rpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(createMatchedSupplierInvoice(payload))
      .rejects.toThrow('AP_MATCHED_INVOICE_RESPONSE_INVALID')

    rpc.mockResolvedValueOnce({ data: { success: true, invoice_id: 'invoice-1' }, error: null })
    await expect(createMatchedSupplierInvoice(payload))
      .rejects.toThrow('AP_MATCHED_INVOICE_RESPONSE_INVALID')
  })

  it('builds the matched write line exclusively from persisted candidate snapshots', () => {
    expect(candidateToMatchedLine(candidate)).toEqual({
      goods_receipt_line_id: 'grl-1',
      quantity_base: 14,
      unit_price: 4.75,
      discount_percentage: 2,
      tax_percentage: 15,
    })
  })

  it('reuses one operation key for an unchanged logical request', () => {
    const factory = vi.fn()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2')

    const first = stableOperationIdentity('same-request', null, factory)
    const retry = stableOperationIdentity('same-request', first, factory)

    expect(first).toEqual({ fingerprint: 'same-request', key: 'key-1' })
    expect(retry).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('rotates the key when the logical request changes', () => {
    const factory = vi.fn()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2')

    const first = stableOperationIdentity('request-a', null, factory)
    const changed = stableOperationIdentity('request-b', first, factory)

    expect(changed).toEqual({ fingerprint: 'request-b', key: 'key-2' })
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
