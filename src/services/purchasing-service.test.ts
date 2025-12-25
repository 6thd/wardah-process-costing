import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock supabase
vi.mock('../lib/supabase', () => {
  return {
    supabase: {
      from: vi.fn()
    }
  }
})

vi.mock('./stock-ledger-service', () => {
  return {
    createStockLedgerEntry: vi.fn(),
    getBin: vi.fn()
  }
})

type SupabaseMock = {
  from: ReturnType<typeof vi.fn>
}

describe('purchasing-service createPurchaseOrder', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('calculates subtotal, discount, and tax correctly', async () => {
    const { createPurchaseOrder } = await import('./purchasing-service')
    const { supabase } = await import('../lib/supabase')

    const poData = {
      id: 'po-1',
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      subtotal: 1000,
      discount_amount: 50,
      tax_amount: 95,
      total_amount: 1045
    }

    const poInsertMock = vi.fn().mockResolvedValue({
      data: poData,
      error: null
    })
    const poSelectMock = vi.fn(() => ({
      single: poInsertMock
    }))

    const linesInsertMock = vi.fn().mockResolvedValue({ error: null })

    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      if (table === 'purchase_orders') {
        return {
          insert: vi.fn(() => ({
            select: poSelectMock
          }))
        }
      }
      if (table === 'purchase_order_lines') {
        return {
          insert: linesInsertMock
        }
      }
      return {}
    })

    const result = await createPurchaseOrder({
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      lines: [
        {
          product_id: 'prod-1',
          quantity: 10,
          unit_price: 100,
          discount_percentage: 5,
          tax_percentage: 10
        }
      ]
    })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      subtotal: 1000,
      discount_amount: 50,
      tax_amount: 95,
      total_amount: 1045
    })
  })

  it('handles multiple lines correctly', async () => {
    const { createPurchaseOrder } = await import('./purchasing-service')
    const { supabase } = await import('../lib/supabase')

    const poData = {
      id: 'po-2',
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      subtotal: 1500,
      discount_amount: 75,
      tax_amount: 142.5,
      total_amount: 1567.5
    }

    const poInsertMock = vi.fn().mockResolvedValue({
      data: poData,
      error: null
    })
    const poSelectMock = vi.fn(() => ({
      single: poInsertMock
    }))

    const linesInsertMock = vi.fn().mockResolvedValue({ error: null })

    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      if (table === 'purchase_orders') {
        return {
          insert: vi.fn(() => ({
            select: poSelectMock
          }))
        }
      }
      if (table === 'purchase_order_lines') {
        return {
          insert: linesInsertMock
        }
      }
      return {}
    })

    const result = await createPurchaseOrder({
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      lines: [
        {
          product_id: 'prod-1',
          quantity: 10,
          unit_price: 100,
          discount_percentage: 5,
          tax_percentage: 10
        },
        {
          product_id: 'prod-2',
          quantity: 5,
          unit_price: 100,
          discount_percentage: 0,
          tax_percentage: 10
        }
      ]
    })

    expect(result.success).toBe(true)
    expect(result.data?.subtotal).toBe(1500)
    expect(result.data?.discount_amount).toBe(75)
    expect(result.data?.tax_amount).toBe(142.5)
    expect(result.data?.total_amount).toBe(1567.5)
  })

  it('handles zero discount and tax', async () => {
    const { createPurchaseOrder } = await import('./purchasing-service')
    const { supabase } = await import('../lib/supabase')

    const poData = {
      id: 'po-3',
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      subtotal: 500,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: 500
    }

    const poInsertMock = vi.fn().mockResolvedValue({
      data: poData,
      error: null
    })
    const poSelectMock = vi.fn(() => ({
      single: poInsertMock
    }))

    const linesInsertMock = vi.fn().mockResolvedValue({ error: null })

    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      if (table === 'purchase_orders') {
        return {
          insert: vi.fn(() => ({
            select: poSelectMock
          }))
        }
      }
      if (table === 'purchase_order_lines') {
        return {
          insert: linesInsertMock
        }
      }
      return {}
    })

    const result = await createPurchaseOrder({
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      lines: [
        {
          product_id: 'prod-1',
          quantity: 5,
          unit_price: 100
        }
      ]
    })

    expect(result.success).toBe(true)
    expect(result.data?.subtotal).toBe(500)
    expect(result.data?.discount_amount).toBe(0)
    expect(result.data?.tax_amount).toBe(0)
    expect(result.data?.total_amount).toBe(500)
  })

  it('returns error when PO insert fails', async () => {
    const { createPurchaseOrder } = await import('./purchasing-service')
    const { supabase } = await import('../lib/supabase')

    const poInsertMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Database error' }
    })
    const poSelectMock = vi.fn(() => ({
      single: poInsertMock
    }))

    ;(supabase as unknown as SupabaseMock).from.mockReturnValue({
      insert: vi.fn(() => ({
        select: poSelectMock
      }))
    } as any)

    const result = await createPurchaseOrder({
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      lines: [
        {
          product_id: 'prod-1',
          quantity: 10,
          unit_price: 100
        }
      ]
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatchObject({ message: 'Database error' })
  })

  it('returns error when lines insert fails', async () => {
    const { createPurchaseOrder } = await import('./purchasing-service')
    const { supabase } = await import('../lib/supabase')

    const poData = {
      id: 'po-4',
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      subtotal: 1000,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: 1000
    }

    const poInsertMock = vi.fn().mockResolvedValue({
      data: poData,
      error: null
    })
    const poSelectMock = vi.fn(() => ({
      single: poInsertMock
    }))

    const linesInsertMock = vi.fn().mockResolvedValue({
      error: { message: 'Lines insert failed' }
    })

    ;(supabase as unknown as SupabaseMock).from.mockImplementation((table: string) => {
      if (table === 'purchase_orders') {
        return {
          insert: vi.fn(() => ({
            select: poSelectMock
          }))
        }
      }
      if (table === 'purchase_order_lines') {
        return {
          insert: linesInsertMock
        }
      }
      return {}
    })

    const result = await createPurchaseOrder({
      vendor_id: 'vendor-1',
      order_date: '2025-01-15',
      status: 'draft',
      lines: [
        {
          product_id: 'prod-1',
          quantity: 10,
          unit_price: 100
        }
      ]
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatchObject({ message: 'Lines insert failed' })
  })
})

