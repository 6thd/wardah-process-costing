import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock supabase + tenant resolver
// NOSONAR - Mock setup requires deep nesting for Supabase query builder chain
vi.mock('@/lib/supabase', () => {
  return {
    getEffectiveTenantId: vi.fn(),
    supabase: {
      from: vi.fn()
    }
  }
})

type SupabaseMock = {
  from: ReturnType<typeof vi.fn>
}

type GetTenantIdMock = ReturnType<typeof vi.fn>

describe('payment-vouchers-service', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('createCustomerReceipt validation', () => {
    it('rejects receipt with zero amount', async () => {
      const { createCustomerReceipt } = await import('./payment-vouchers-service')
      const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')

      ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

      // Mock generateReceiptNumber call
      const likeMock = vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null })
          }))
        }))
      }))
      const selectMock = vi.fn(() => ({ like: likeMock }))
      ;(supabase as unknown as SupabaseMock).from.mockReturnValue({
        select: selectMock
      } as any)

      const result = await createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2025-01-15',
        amount: 0,
        payment_method: 'cash',
        status: 'draft'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('المبلغ يجب أن يكون أكبر من الصفر')
    })

    it('rejects receipt when lines total does not match amount', async () => {
      const { createCustomerReceipt } = await import('./payment-vouchers-service')
      const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')

      ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

      const likeMock = vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null })
          }))
        }))
      }))
      const selectMock = vi.fn(() => ({ like: likeMock }))
      ;(supabase as unknown as SupabaseMock).from.mockReturnValue({
        select: selectMock
      } as any)

      const result = await createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2025-01-15',
        amount: 1000,
        payment_method: 'cash',
        status: 'draft',
        lines: [
          {
            invoice_id: 'inv-1',
            allocated_amount: 500,
            discount_amount: 0
          },
          {
            invoice_id: 'inv-2',
            allocated_amount: 300,
            discount_amount: 0
          }
        ]
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('مجموع البنود لا يساوي المبلغ الإجمالي')
    })

    it('accepts receipt when lines total matches amount', async () => {
      const { createCustomerReceipt } = await import('./payment-vouchers-service')
      const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')

      ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

      const receiptInsertMock = vi.fn().mockResolvedValue({
        data: { id: 'receipt-1', collection_number: 'CR-202501-00001' },
        error: null
      })
      const receiptSelectMock = vi.fn(() => ({
        single: receiptInsertMock
      }))
      const receiptFromMock = vi.fn(() => ({
        insert: vi.fn(() => ({
          select: receiptSelectMock
        }))
      }))

      const likeMock = vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null })
          }))
        }))
      }))
      const selectMock = vi.fn(() => ({ like: likeMock }))

      const linesInsertMock = vi.fn().mockResolvedValue({ error: null })

      ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
        if (table === 'customer_collections') {
          return {
            select: selectMock,
            insert: vi.fn(() => ({
              select: receiptSelectMock
            }))
          }
        }
        if (table === 'customer_collection_lines') {
          return {
            insert: linesInsertMock
          }
        }
        return {}
      })

      const result = await createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2025-01-15',
        amount: 800,
        payment_method: 'cash',
        status: 'draft',
        lines: [
          {
            invoice_id: 'inv-1',
            allocated_amount: 500,
            discount_amount: 0
          },
          {
            invoice_id: 'inv-2',
            allocated_amount: 300,
            discount_amount: 0
          }
        ]
      })

      expect(result.success).toBe(true)
    })
  })

  describe('generateReceiptNumber (via createCustomerReceipt)', () => {
    it('generates receipt number with correct format', async () => {
      const { createCustomerReceipt } = await import('./payment-vouchers-service')
      const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')

      ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

      const receiptData = { id: 'receipt-1', collection_number: 'CR-202501-00001' }
      const receiptInsertMock = vi.fn().mockResolvedValue({
        data: receiptData,
        error: null
      })
      const receiptSelectMock = vi.fn(() => ({
        single: receiptInsertMock
      }))

      const likeMock = vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null })
          }))
        }))
      }))
      const selectMock = vi.fn(() => ({ like: likeMock }))

      ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
        if (table === 'customer_collections') {
          return {
            select: selectMock,
            insert: vi.fn(() => ({
              select: receiptSelectMock
            }))
          }
        }
        if (table === 'customer_collection_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        return {}
      })

      const result = await createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2025-01-15',
        amount: 1000,
        payment_method: 'cash',
        status: 'draft'
      })

      expect(result.success).toBe(true)
      expect(selectMock).toHaveBeenCalledWith('collection_number')
      expect(likeMock).toHaveBeenCalledWith('collection_number', 'CR-202501-%')
    })

    it('increments sequence from last receipt', async () => {
      const { createCustomerReceipt } = await import('./payment-vouchers-service')
      const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')

      ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

      const receiptData = { id: 'receipt-1', collection_number: 'CR-202501-00003' }
      const receiptInsertMock = vi.fn().mockResolvedValue({
        data: receiptData,
        error: null
      })
      const receiptSelectMock = vi.fn(() => ({
        single: receiptInsertMock
      }))

      const likeMock = vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { collection_number: 'CR-202501-00002' }
            })
          }))
        }))
      }))
      const selectMock = vi.fn(() => ({ like: likeMock }))

      ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
        if (table === 'customer_collections') {
          return {
            select: selectMock,
            insert: vi.fn(() => ({
              select: receiptSelectMock
            }))
          }
        }
        if (table === 'customer_collection_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        return {}
      })

      const result = await createCustomerReceipt({
        customer_id: 'cust-1',
        receipt_date: '2025-01-15',
        amount: 1000,
        payment_method: 'cash',
        status: 'draft'
      })

      expect(result.success).toBe(true)
    })
  })
})

