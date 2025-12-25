import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock supabase + tenant resolver used by the module under test
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

function makeLimitReturning(data: any, error: any) {
  return vi.fn().mockResolvedValue({ data, error })
}

function makeQueryBuilderForLastNumber(fieldName: string, lastValue: string | null, error: any = null) {
  const limit = makeLimitReturning(lastValue ? [{ [fieldName]: lastValue }] : [], error)
  const order = vi.fn(() => ({ limit }))
  const eq = vi.fn(() => ({ order }))
  const select = vi.fn(() => ({ eq }))
  return { select, eq, order, limit }
}

describe('enhanced-sales-service number generators (__testables)', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('generates next sales order number from last SO number', async () => {
    const mod = await import('./enhanced-sales-service')
    const { supabase, getEffectiveTenantId } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

    const qb = makeQueryBuilderForLastNumber('so_number', 'SO-000009')
    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      expect(table).toBe('sales_orders')
      return qb
    })

    const next = await mod.__testables.generateSalesOrderNumber()
    expect(next).toBe('SO-000010')
    expect(qb.select).toHaveBeenCalledWith('so_number')
    expect(qb.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1')
  })

  it('starts sales order sequence at SO-000001 when no prior rows', async () => {
    const mod = await import('./enhanced-sales-service')
    const { supabase, getEffectiveTenantId } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

    const qb = makeQueryBuilderForLastNumber('so_number', null)
    ;(supabase as unknown as SupabaseMock).from.mockReturnValue(qb as any)

    const next = await mod.__testables.generateSalesOrderNumber()
    expect(next).toBe('SO-000001')
  })

  it('falls back to timestamped SO number when tenant id is missing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))

    const mod = await import('./enhanced-sales-service')
    const { getEffectiveTenantId } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue(null)

    const next = await mod.__testables.generateSalesOrderNumber()
    expect(next).toBe(`SO-${Date.parse('2025-01-01T00:00:00.000Z')}`)
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('generates next invoice number from last SI number', async () => {
    const mod = await import('./enhanced-sales-service')
    const { supabase, getEffectiveTenantId } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

    const qb = makeQueryBuilderForLastNumber('invoice_number', 'SI-000199')
    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      expect(table).toBe('sales_invoices')
      return qb
    })

    const next = await mod.__testables.generateInvoiceNumber()
    expect(next).toBe('SI-000200')
  })

  it('generates next delivery number from last DN number', async () => {
    const mod = await import('./enhanced-sales-service')
    const { supabase, getEffectiveTenantId } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

    const qb = makeQueryBuilderForLastNumber('delivery_number', 'DN-000010')
    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      expect(table).toBe('delivery_notes')
      return qb
    })

    const next = await mod.__testables.generateDeliveryNumber()
    expect(next).toBe('DN-000011')
  })
})

describe('enhanced-sales-service createSalesOrder', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('rejects order with no lines', async () => {
    const { createSalesOrder } = await import('./enhanced-sales-service')
    const { getEffectiveTenantId } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

    const result = await createSalesOrder(
      {
        customer_id: 'cust-1',
        order_date: '2025-01-15',
        status: 'draft',
        subtotal: 1000,
        total_amount: 1000,
        tax_amount: 0
      },
      []
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('at least one line')
  })

  it('rejects order when stock unavailable', async () => {
    const { createSalesOrder } = await import('./enhanced-sales-service')
    const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

    // Mock checkStockAvailability to return unavailable
    const itemsSelectMock = vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { stock_quantity: 5, name: 'Product A', name_ar: 'منتج أ' },
          error: null
        })
      }))
    }))

    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      if (table === 'items') {
        return { select: itemsSelectMock }
      }
      return {}
    })

    const result = await createSalesOrder(
      {
        customer_id: 'cust-1',
        order_date: '2025-01-15',
        status: 'draft',
        subtotal: 1000,
        total_amount: 1000,
        tax_amount: 0
      },
      [
        {
          item_id: 'item-1',
          line_number: 1,
          quantity: 10,
          unit_price: 100,
          total_price: 1000
        }
      ]
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Insufficient stock')
  })

  it('rejects order when credit limit exceeded', async () => {
    const { createSalesOrder } = await import('./enhanced-sales-service')
    const { getEffectiveTenantId, supabase } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

    // Mock stock check - available
    const itemsSelectMock = vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { stock_quantity: 100, name: 'Product A' },
          error: null
        })
      }))
    }))

    // Mock credit check - exceeded
    const customersSelectMock = vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { credit_limit: 500 },
          error: null
        })
      }))
    }))

    const invoicesInMock = vi.fn().mockResolvedValue({
      data: [{ total_amount: 400, paid_amount: 0 }],
      error: null
    })
    const invoicesEqMock2 = vi.fn(() => ({
      in: invoicesInMock
    }))
    const invoicesEqMock1 = vi.fn(() => ({
      eq: invoicesEqMock2
    }))
    const invoicesSelectMock = vi.fn(() => ({
      eq: invoicesEqMock1
    }))

    // Mock sales_orders insert (will be called but should fail before due to credit check)
    const salesOrdersInsertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'so-1' },
          error: null
        })
      }))
    }))

    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      if (table === 'items') return { select: itemsSelectMock }
      if (table === 'customers') return { select: customersSelectMock }
      if (table === 'sales_invoices') return { select: invoicesSelectMock }
      if (table === 'sales_orders') return { insert: salesOrdersInsertMock }
      return {}
    })

    const result = await createSalesOrder(
      {
        customer_id: 'cust-1',
        order_date: '2025-01-15',
        status: 'draft',
        subtotal: 200,
        total_amount: 200, // Would exceed limit (400 + 200 > 500)
        tax_amount: 0
      },
      [
        {
          item_id: 'item-1',
          line_number: 1,
          quantity: 1,
          unit_price: 200,
          total_price: 200
        }
      ]
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Credit limit exceeded')
  })
})

describe('enhanced-sales-service confirmSalesOrder', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('confirms sales order successfully', async () => {
    const { confirmSalesOrder } = await import('./enhanced-sales-service')
    const { supabase } = await import('@/lib/supabase')

    const eqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn(() => ({ eq: eqMock }))

    ;(supabase as unknown as SupabaseMock).from.mockReturnValue({
      update: updateMock
    } as any)

    const result = await confirmSalesOrder('order-1')

    expect(result.success).toBe(true)
    expect(updateMock).toHaveBeenCalled()
    expect(eqMock).toHaveBeenCalledWith('id', 'order-1')
  })

  it('handles error when confirming order', async () => {
    const { confirmSalesOrder } = await import('./enhanced-sales-service')
    const { supabase } = await import('@/lib/supabase')

    const eqMock = vi.fn().mockResolvedValue({ error: { message: 'Database error' } })
    const updateMock = vi.fn(() => ({ eq: eqMock }))

    ;(supabase as unknown as SupabaseMock).from.mockReturnValue({
      update: updateMock
    } as any)

    const result = await confirmSalesOrder('order-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Database error')
  })
})

describe('enhanced-sales-service createSalesInvoice', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('rejects invoice with no lines', async () => {
    const { createSalesInvoice } = await import('./enhanced-sales-service')
    const { getEffectiveTenantId } = await import('@/lib/supabase')

    ;(getEffectiveTenantId as unknown as GetTenantIdMock).mockResolvedValue('tenant-1')

    const result = await createSalesInvoice({
      customer_id: 'cust-1',
      invoice_date: '2025-01-15',
      due_date: '2025-01-30',
      delivery_status: 'pending',
      payment_status: 'unpaid',
      subtotal: 1000,
      tax_amount: 0,
      total_amount: 1000,
      lines: []
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('at least one line')
  })
})



