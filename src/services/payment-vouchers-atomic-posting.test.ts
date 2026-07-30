import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
  getEffectiveTenantId: vi.fn()
}))

describe('atomic payment voucher posting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts a customer receipt through the atomic database RPC', async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        receipt_id: 'receipt-1',
        entry_id: 'entry-1',
        status: 'posted'
      },
      error: null
    })

    const { postCustomerReceipt } = await import('./payment-vouchers-service')
    const result = await postCustomerReceipt('receipt-1')

    expect(rpcMock).toHaveBeenCalledWith('rpc_post_customer_receipt', {
      p_receipt_id: 'receipt-1'
    })
    expect(result).toEqual({
      success: true,
      data: {
        success: true,
        receipt_id: 'receipt-1',
        entry_id: 'entry-1',
        status: 'posted'
      }
    })
  })

  it('fails closed when customer receipt posting is rejected', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'CUSTOMER_RECEIPT_OVER_ALLOCATION' }
    })

    const { postCustomerReceipt } = await import('./payment-vouchers-service')
    const result = await postCustomerReceipt('receipt-over')

    expect(result).toEqual({
      success: false,
      error: 'CUSTOMER_RECEIPT_OVER_ALLOCATION'
    })
  })

  it('posts a supplier payment through the atomic database RPC', async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        payment_id: 'payment-1',
        entry_id: 'entry-2',
        status: 'posted'
      },
      error: null
    })

    const { postSupplierPayment } = await import('./payment-vouchers-service')
    const result = await postSupplierPayment('payment-1')

    expect(rpcMock).toHaveBeenCalledWith('rpc_post_supplier_payment', {
      p_payment_id: 'payment-1'
    })
    expect(result).toEqual({
      success: true,
      data: {
        success: true,
        payment_id: 'payment-1',
        entry_id: 'entry-2',
        status: 'posted'
      }
    })
  })

  it('fails closed when supplier payment RPC returns an invalid result', async () => {
    rpcMock.mockResolvedValue({ data: { success: false }, error: null })

    const { postSupplierPayment } = await import('./payment-vouchers-service')
    const result = await postSupplierPayment('payment-invalid')

    expect(result).toEqual({
      success: false,
      error: 'Supplier payment posting failed'
    })
  })
})
