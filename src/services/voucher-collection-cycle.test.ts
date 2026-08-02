import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The collection scenarios that used to live in the legacy
 * `recordCustomerCollection` writers, restated against the voucher cycle that
 * replaced them.
 *
 * Those writers mutated `sales_invoices.paid_amount` and `payment_status`
 * directly, bypassing the voucher, the posting step and the audit trail. The
 * cycle below is the only supported path: an atomic draft, then an explicit
 * posting. `paid_amount` and the invoice status are derived server-side by the
 * posting RPC — never computed and written by the client.
 */
vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: vi.fn(),
  supabase: { from: vi.fn(), rpc: vi.fn() }
}))

type SupabaseMock = {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

async function loadService() {
  const service = await import('./payment-vouchers-service')
  const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')
  ;(getEffectiveTenantId as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('tenant-1')
  return { service, supabase: supabase as unknown as SupabaseMock }
}

describe('customer collection cycle (create → post)', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('records a partial collection as a draft, then posts it as a separate step', async () => {
    const { service, supabase } = await loadService()
    supabase.rpc
      .mockResolvedValueOnce({
        data: {
          success: true,
          receipt_id: 'receipt-1',
          receipt_number: 'CR-2026-00011',
          status: 'draft',
          line_count: 1
        },
        error: null
      })
      .mockResolvedValueOnce({ data: { success: true }, error: null })

    // Collecting 300 against an invoice of 1000.
    const created = await service.createCustomerReceipt({
      customer_id: 'cust-1',
      receipt_date: '2026-01-20',
      amount: 300,
      payment_method: 'cash',
      payment_account_id: 'acct-cash',
      lines: [{ invoice_id: 'inv-1', allocated_amount: 300, discount_amount: 0 }]
    })

    expect(created.success).toBe(true)
    expect(created.data?.status).toBe('draft')

    const posted = await service.postCustomerReceipt(created.data!.id!)
    expect(posted.success).toBe(true)

    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      'rpc_create_customer_receipt',
      expect.anything()
    )
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'rpc_post_customer_receipt', {
      p_receipt_id: 'receipt-1'
    })
  })

  it('does not post implicitly on create — the draft stands on its own', async () => {
    const { service, supabase } = await loadService()
    supabase.rpc.mockResolvedValue({
      data: { success: true, receipt_id: 'receipt-2', receipt_number: 'CR-2', status: 'draft' },
      error: null
    })

    await service.createCustomerReceipt({
      customer_id: 'cust-1',
      receipt_date: '2026-01-20',
      amount: 1000,
      payment_method: 'bank_transfer',
      payment_account_id: 'acct-bank',
      lines: [{ invoice_id: 'inv-1', allocated_amount: 1000, discount_amount: 0 }]
    })

    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'rpc_post_customer_receipt',
      expect.anything()
    )
  })

  it('never computes paid_amount or payment_status on the client', async () => {
    const { service, supabase } = await loadService()
    supabase.rpc.mockResolvedValue({
      data: { success: true, receipt_id: 'receipt-3', receipt_number: 'CR-3', status: 'draft' },
      error: null
    })

    await service.createCustomerReceipt({
      customer_id: 'cust-1',
      receipt_date: '2026-01-20',
      amount: 1000,
      payment_method: 'cash',
      payment_account_id: 'acct-cash',
      lines: [{ invoice_id: 'inv-1', allocated_amount: 1000, discount_amount: 0 }]
    })

    // The invoice is never touched by the client on either step.
    expect(supabase.from).not.toHaveBeenCalled()
    const payload = supabase.rpc.mock.calls[0][1].p_payload
    expect(payload).not.toHaveProperty('paid_amount')
    expect(payload).not.toHaveProperty('payment_status')
  })

  it('surfaces a posting failure instead of reporting success', async () => {
    const { service, supabase } = await loadService()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'VOUCHER_PAYMENT_ACCOUNT_MISMATCH: account does not match the method' }
    })

    const posted = await service.postCustomerReceipt('receipt-4')
    expect(posted.success).toBe(false)
  })
})

describe('supplier payment cycle (create → post)', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('creates a draft payment, then posts it explicitly', async () => {
    const { service, supabase } = await loadService()
    supabase.rpc
      .mockResolvedValueOnce({
        data: {
          success: true,
          payment_id: 'pay-1',
          payment_number: 'SP-2026-00008',
          status: 'draft',
          line_count: 1
        },
        error: null
      })
      .mockResolvedValueOnce({ data: { success: true }, error: null })

    const created = await service.createSupplierPayment({
      vendor_id: 'vendor-1',
      payment_date: '2026-01-20',
      amount: 750,
      payment_method: 'bank_transfer',
      payment_account_id: 'acct-bank',
      lines: [{ invoice_id: 'sinv-1', allocated_amount: 750, discount_amount: 0 }]
    })

    expect(created.data?.status).toBe('draft')

    const posted = await service.postSupplierPayment(created.data!.id!)
    expect(posted.success).toBe(true)
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'rpc_post_supplier_payment', {
      p_payment_id: 'pay-1'
    })
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
