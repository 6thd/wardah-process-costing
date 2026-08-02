import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase + tenant resolver
vi.mock('@/lib/supabase', () => {
  return {
    getEffectiveTenantId: vi.fn(),
    supabase: {
      from: vi.fn(),
      rpc: vi.fn()
    }
  }
})

type SupabaseMock = {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

type GetTenantIdMock = ReturnType<typeof vi.fn>

async function loadService() {
  const service = await import('./payment-vouchers-service')
  const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')
  ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')
  return { service, supabase: supabase as unknown as SupabaseMock }
}

describe('payment-vouchers-service', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  describe('createCustomerReceipt', () => {
    it('delegates to rpc_create_customer_receipt with the full payload', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: {
          success: true,
          receipt_id: 'receipt-1',
          receipt_number: 'CR-2026-00007',
          status: 'draft',
          line_count: 2
        },
        error: null
      })

      const result = await service.createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2026-01-15',
        amount: 800,
        payment_method: 'cash',
        payment_account_id: 'acct-1',
        lines: [
          { invoice_id: 'inv-1', allocated_amount: 500, discount_amount: 0 },
          { invoice_id: 'inv-2', allocated_amount: 300, discount_amount: 0 }
        ]
      })

      expect(result.success).toBe(true)
      expect(result.data?.id).toBe('receipt-1')
      // The number comes from the server, never from the client.
      expect(result.data?.receipt_number).toBe('CR-2026-00007')
      expect(supabase.rpc).toHaveBeenCalledWith('rpc_create_customer_receipt', {
        p_payload: expect.objectContaining({
          customer_id: 'cust-1',
          amount: 800,
          payment_account_id: 'acct-1',
          lines: [
            { invoice_id: 'inv-1', allocated_amount: 500, discount_amount: 0, notes: null },
            { invoice_id: 'inv-2', allocated_amount: 300, discount_amount: 0, notes: null }
          ]
        })
      })
    })

    it('never writes to customer_collections directly', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: { success: true, receipt_id: 'receipt-1', receipt_number: 'CR-1', status: 'draft' },
        error: null
      })

      await service.createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2026-01-15',
        amount: 100,
        payment_method: 'cash'
      })

      expect(supabase.from).not.toHaveBeenCalled()
    })

    it('rejects a zero amount before reaching the server', async () => {
      const { service, supabase } = await loadService()

      const result = await service.createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2026-01-15',
        amount: 0,
        payment_method: 'cash'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('المبلغ يجب أن يكون أكبر من الصفر')
      expect(supabase.rpc).not.toHaveBeenCalled()
    })

    it('rejects when the allocation total does not match the amount', async () => {
      const { service, supabase } = await loadService()

      const result = await service.createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2026-01-15',
        amount: 1000,
        payment_method: 'cash',
        lines: [
          { invoice_id: 'inv-1', allocated_amount: 500, discount_amount: 0 },
          { invoice_id: 'inv-2', allocated_amount: 300, discount_amount: 0 }
        ]
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('مجموع البنود لا يساوي المبلغ الإجمالي')
      expect(supabase.rpc).not.toHaveBeenCalled()
    })

    it('surfaces the server over-allocation refusal', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'CUSTOMER_RECEIPT_OVER_ALLOCATION: invoice=inv-1 open=100 allocated=500' }
      })

      const result = await service.createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2026-01-15',
        amount: 500,
        payment_method: 'cash',
        lines: [{ invoice_id: 'inv-1', allocated_amount: 500, discount_amount: 0 }]
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('التخصيص يتجاوز الرصيد المفتوح للفاتورة')
      // The raw code stays available for support and logs.
      expect(result.error).toContain('CUSTOMER_RECEIPT_OVER_ALLOCATION')
    })
  })

  describe('createSupplierPayment', () => {
    it('delegates to rpc_create_supplier_payment and carries check_bank', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: {
          success: true,
          payment_id: 'pay-1',
          payment_number: 'SP-2026-00003',
          status: 'draft',
          line_count: 1
        },
        error: null
      })

      const result = await service.createSupplierPayment({
        vendor_id: 'vendor-1',
        payment_date: '2026-01-15',
        amount: 250,
        payment_method: 'check',
        payment_account_id: 'acct-9',
        check_number: '4471',
        check_bank: 'Al Rajhi',
        lines: [{ invoice_id: 'sinv-1', allocated_amount: 250, discount_amount: 0 }]
      })

      expect(result.success).toBe(true)
      expect(result.data?.payment_number).toBe('SP-2026-00003')
      expect(supabase.rpc).toHaveBeenCalledWith('rpc_create_supplier_payment', {
        p_payload: expect.objectContaining({
          vendor_id: 'vendor-1',
          check_bank: 'Al Rajhi'
        })
      })
      expect(supabase.from).not.toHaveBeenCalled()
    })

    it('surfaces the non-payable supplier invoice refusal', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'SUPPLIER_INVOICE_NOT_PAYABLE: invoice=sinv-1 status=draft' }
      })

      const result = await service.createSupplierPayment({
        vendor_id: 'vendor-1',
        payment_date: '2026-01-15',
        amount: 100,
        payment_method: 'bank_transfer',
        lines: [{ invoice_id: 'sinv-1', allocated_amount: 100, discount_amount: 0 }]
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('فاتورة المورد غير قابلة للسداد')
    })
  })

  describe('draft editing', () => {
    it('always sends the complete allocation set, including an empty one', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: { success: true, receipt_id: 'receipt-1', status: 'draft', line_count: 0, lines_removed: 2 },
        error: null
      })

      const result = await service.updateCustomerReceiptDraft('receipt-1', { lines: [] })

      expect(result.success).toBe(true)
      expect(supabase.rpc).toHaveBeenCalledWith('rpc_update_customer_receipt_draft', {
        p_receipt_id: 'receipt-1',
        p_payload: expect.objectContaining({ lines: [] })
      })
    })

    it('surfaces the refusal to edit a voucher that never passed a reset', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'CUSTOMER_RECEIPT_CORRECTION_UNPROVEN: no trusted reset record' }
      })

      const result = await service.updateCustomerReceiptDraft('receipt-1', {
        lines: [{ invoice_id: 'inv-1', allocated_amount: 50 }]
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('لم يمر بدورة إعادة التصحيح')
    })

    it('replaces a supplier payment allocation set', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: { success: true, payment_id: 'pay-1', status: 'draft', line_count: 1, lines_removed: 1 },
        error: null
      })

      const result = await service.updateSupplierPaymentDraft('pay-1', {
        amount: 400,
        lines: [{ invoice_id: 'sinv-2', allocated_amount: 400, discount_amount: 0 }]
      })

      expect(result.success).toBe(true)
      expect(supabase.rpc).toHaveBeenCalledWith('rpc_update_supplier_payment_draft', {
        p_payment_id: 'pay-1',
        p_payload: expect.objectContaining({ amount: 400 })
      })
    })
  })

  describe('reset to draft', () => {
    it('delegates to rpc_reset_customer_receipt_to_draft with the reason', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: { success: true, duplicate: false, receipt_id: 'receipt-1', entry_id: 'gl-1', status: 'draft' },
        error: null
      })

      const result = await service.resetCustomerReceiptToDraft('receipt-1', 'تصحيح مبلغ')

      expect(result.success).toBe(true)
      expect(result.duplicate).toBe(false)
      expect(supabase.rpc).toHaveBeenCalledWith('rpc_reset_customer_receipt_to_draft', {
        p_receipt_id: 'receipt-1',
        p_reason: 'تصحيح مبلغ'
      })
      expect(supabase.from).not.toHaveBeenCalled()
    })

    it('reports an already-draft receipt as a duplicate, not a failure', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: { success: true, duplicate: true, receipt_id: 'receipt-1', status: 'draft' },
        error: null
      })

      const result = await service.resetCustomerReceiptToDraft('receipt-1', 'تصحيح مبلغ')

      expect(result.success).toBe(true)
      expect(result.duplicate).toBe(true)
    })

    it('surfaces the missing unpost permission', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'VOUCHER_UNPOST_PERMISSION_REQUIRED' }
      })

      const result = await service.resetCustomerReceiptToDraft('receipt-1', 'تصحيح مبلغ')

      expect(result.success).toBe(false)
      expect(result.error).toContain('لا تملك صلاحية إعادة السندات إلى مسودة')
    })

    it('surfaces an invoice that drifted since posting', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'SUPPLIER_PAYMENT_UNPOST_INVOICE_DRIFT: invoice=inv-1 paid=0 allocated=100' }
      })

      const result = await service.resetSupplierPaymentToDraft('pay-1', 'تصحيح مبلغ')

      expect(result.success).toBe(false)
      expect(result.error).toContain('رصيد الفاتورة تغيّر منذ الترحيل')
      expect(supabase.rpc).toHaveBeenCalledWith('rpc_reset_supplier_payment_to_draft', {
        p_payment_id: 'pay-1',
        p_reason: 'تصحيح مبلغ'
      })
    })
  })

  describe('payment account guards (Migration 165)', () => {
    it('explains a non-postable or cross-org account', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'VOUCHER_PAYMENT_ACCOUNT_INVALID_OR_CROSS_ORG' }
      })

      const result = await service.createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2026-01-15',
        amount: 100,
        payment_method: 'cash',
        payment_account_id: 'parent-account'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('يقبل الترحيل')
    })

    it('explains a method/account subtype mismatch', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'VOUCHER_PAYMENT_ACCOUNT_METHOD_MISMATCH: method=cash account_subtype=BANK expected=CASH' }
      })

      const result = await service.createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2026-01-15',
        amount: 100,
        payment_method: 'cash',
        payment_account_id: 'bank-account'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('لا يتوافق مع طريقة السداد')
    })
  })

  describe('cancellation', () => {
    it('cancels a customer receipt with a reason', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: {
          success: true,
          duplicate: false,
          receipt_id: 'receipt-1',
          status: 'cancelled',
          entry_id: null,
          path: 'draft_only'
        },
        error: null
      })

      const result = await service.cancelCustomerReceipt('receipt-1', 'قيد مكرر')

      expect(result.success).toBe(true)
      expect(result.duplicate).toBe(false)
      expect(supabase.rpc).toHaveBeenCalledWith('rpc_cancel_customer_receipt', {
        p_receipt_id: 'receipt-1',
        p_reason: 'قيد مكرر'
      })
    })

    it('reports an already-cancelled receipt as a duplicate, not a failure', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: { success: true, duplicate: true, receipt_id: 'receipt-1', status: 'cancelled' },
        error: null
      })

      const result = await service.cancelCustomerReceipt('receipt-1', 'تكرار')

      expect(result.success).toBe(true)
      expect(result.duplicate).toBe(true)
    })

    it('surfaces the refusal to cancel a posted voucher', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'VOUCHER_CANCEL_REQUIRES_RESET: reset the receipt before cancelling it' }
      })

      const result = await service.cancelCustomerReceipt('receipt-1', 'خطأ')

      expect(result.success).toBe(false)
      expect(result.error).toContain('أعد السند إلى مسودة قبل إلغائه')
    })

    it('surfaces the missing cancel permission', async () => {
      const { service, supabase } = await loadService()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'VOUCHER_CANCEL_PERMISSION_REQUIRED' }
      })

      const result = await service.cancelSupplierPayment('pay-1', 'خطأ')

      expect(result.success).toBe(false)
      expect(result.error).toContain('لا تملك صلاحية إلغاء السندات')
      expect(supabase.rpc).toHaveBeenCalledWith('rpc_cancel_supplier_payment', {
        p_payment_id: 'pay-1',
        p_reason: 'خطأ'
      })
    })
  })
})
