import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The module uses these imports at module load time; mock them to keep tests pure.
vi.mock('../lib/supabase', () => {
  return {
    getSupabase: vi.fn(),
    getTenantId: vi.fn()
  }
})

vi.mock('./manufacturing', () => {
  return {
    updateManufacturingOrderStatus: vi.fn(),
    createManufacturingOrder: vi.fn(),
    getManufacturingOrderById: vi.fn()
  }
})

// Mock fetch for getConfig
global.fetch = vi.fn()

type GetSupabaseMock = ReturnType<typeof vi.fn>

describe('supabase-service itemsService.updateStock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-02T03:04:05.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setupSupabaseForUpdateStock(initialStock: number) {
    const fromProductsSelect = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { stock_quantity: initialStock } })
        }))
      }))
    }

    const productsUpdatePayloads: any[] = []
    const fromProductsUpdate = {
      update: vi.fn((payload: any) => {
        productsUpdatePayloads.push(payload)
        return {
          eq: vi.fn().mockResolvedValue({ error: null })
        }
      })
    }

    const stockMovementInserts: any[] = []
    const fromStockMovements = {
      insert: vi.fn((payload: any) => {
        stockMovementInserts.push(payload)
        return Promise.resolve({ error: null })
      })
    }

    const supabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'products') {
          // `updateStock` calls products twice: first select(), then update()
          // We return an object that supports both entrypoints.
          return {
            ...fromProductsSelect,
            ...fromProductsUpdate
          }
        }
        if (table === 'stock_movements') return fromStockMovements
        throw new Error(`Unexpected table: ${table}`)
      })
    }

    return { supabaseClient, productsUpdatePayloads, stockMovementInserts }
  }

  it('increases stock for movementType=in and records movement', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const { supabaseClient, productsUpdatePayloads, stockMovementInserts } = setupSupabaseForUpdateStock(10)
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    await itemsService.updateStock('item-1', 5, 'in', 'user-1', 'note')

    expect(productsUpdatePayloads).toHaveLength(1)
    expect(productsUpdatePayloads[0]).toMatchObject({
      stock_quantity: 15,
      updated_at: new Date('2025-01-02T03:04:05.000Z').toISOString()
    })

    expect(stockMovementInserts).toHaveLength(1)
    expect(stockMovementInserts[0]).toEqual({
      item_id: 'item-1',
      movement_type: 'in',
      quantity: 5,
      notes: 'note',
      created_by: 'user-1'
    })
  })

  it('decreases stock for movementType=out and records movement', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const { supabaseClient, productsUpdatePayloads, stockMovementInserts } = setupSupabaseForUpdateStock(10)
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    await itemsService.updateStock('item-1', 3, 'out', 'user-1')

    expect(productsUpdatePayloads[0].stock_quantity).toBe(7)
    expect(stockMovementInserts[0].quantity).toBe(3)
  })

  it('sets stock for movementType=adjustment and records delta quantity', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const { supabaseClient, productsUpdatePayloads, stockMovementInserts } = setupSupabaseForUpdateStock(10)
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    await itemsService.updateStock('item-1', 25, 'adjustment', 'user-1')

    expect(productsUpdatePayloads[0].stock_quantity).toBe(25)
    // adjustment stores delta vs previous
    expect(stockMovementInserts[0].quantity).toBe(15)
  })

  it('throws when item does not exist', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const supabaseClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null })
          }))
        }))
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    await expect(itemsService.updateStock('missing', 1, 'in', 'user-1')).rejects.toThrow('Item not found')
  })
})

describe('supabase-service itemsService CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getAll returns items ordered by created_at', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const mockItems = [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }]
    const orderMock = vi.fn().mockResolvedValue({ data: mockItems, error: null })
    const selectMock = vi.fn(() => ({ order: orderMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        select: selectMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await itemsService.getAll()

    expect(result).toEqual(mockItems)
    expect(selectMock).toHaveBeenCalledWith('*')
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('getById returns single item', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const mockItem = { id: '1', name: 'Item 1' }
    const singleMock = vi.fn().mockResolvedValue({ data: mockItem, error: null })
    const eqMock = vi.fn(() => ({ single: singleMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        select: selectMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await itemsService.getById('1')

    expect(result).toEqual(mockItem)
    expect(eqMock).toHaveBeenCalledWith('id', '1')
  })

  it('create inserts new item', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const newItem = { name: 'New Item', code: 'NI001' }
    const createdItem = { id: '1', ...newItem }
    const singleMock = vi.fn().mockResolvedValue({ data: createdItem, error: null })
    const selectMock = vi.fn(() => ({ single: singleMock }))
    const insertMock = vi.fn(() => ({ select: selectMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        insert: insertMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await itemsService.create(newItem)

    expect(result).toEqual(createdItem)
    expect(insertMock).toHaveBeenCalledWith(newItem)
  })

  it('update modifies existing item', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-02T03:04:05.000Z'))

    const updates = { name: 'Updated Item' }
    const updatedItem = { id: '1', ...updates, updated_at: new Date().toISOString() }
    const singleMock = vi.fn().mockResolvedValue({ data: updatedItem, error: null })
    const selectMock = vi.fn(() => ({ single: singleMock }))
    const eqMock = vi.fn(() => ({ select: selectMock }))
    const updateMock = vi.fn(() => ({ eq: eqMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        update: updateMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await itemsService.update('1', updates)

    expect(result).toEqual(updatedItem)
    expect(updateMock).toHaveBeenCalled()
    expect(eqMock).toHaveBeenCalledWith('id', '1')

    vi.useRealTimers()
  })

  it('delete removes item', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const eqMock = vi.fn().mockResolvedValue({ error: null })
    const deleteMock = vi.fn(() => ({ eq: eqMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        delete: deleteMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    await itemsService.delete('1')

    expect(deleteMock).toHaveBeenCalled()
    expect(eqMock).toHaveBeenCalledWith('id', '1')
  })

  it('getLowStock returns items below minimum', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { itemsService } = await import('./supabase-service')

    const lowStockItems = [{ id: '1', stock_quantity: 5, minimum_stock: 10 }]
    const filterMock = vi.fn().mockResolvedValue({ data: lowStockItems, error: null })
    const selectMock = vi.fn(() => ({ filter: filterMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        select: selectMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await itemsService.getLowStock()

    expect(result).toEqual(lowStockItems)
    expect(filterMock).toHaveBeenCalledWith('stock_quantity', 'lte', 'minimum_stock')
  })
})

describe('supabase-service categoriesService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock fetch for getConfig
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ TABLE_NAMES: { categories: 'categories' } })
    })
  })

  it('getAll returns categories ordered by name without tenant filter', async () => {
    const { getSupabase, getTenantId } = await import('../lib/supabase')
    const { categoriesService } = await import('./supabase-service')

    const mockCategories = [{ id: '1', name: 'Category A' }, { id: '2', name: 'Category B' }]
    const finalResult = { data: mockCategories, error: null }
    
    // When no tenantId, query is: select().order() -> await
    const orderMock = vi.fn().mockResolvedValue(finalResult)
    
    const selectMock = vi.fn(() => ({ 
      order: orderMock
    }))

    const supabaseClient = {
      from: vi.fn(() => ({
        select: selectMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)
    ;(getTenantId as unknown as GetSupabaseMock).mockResolvedValue(null)

    const result = await categoriesService.getAll()

    expect(result).toEqual(mockCategories)
    expect(orderMock).toHaveBeenCalledWith('name')
  })

  it('create inserts new category with tenant_id', async () => {
    const { getSupabase, getTenantId } = await import('../lib/supabase')
    const { categoriesService } = await import('./supabase-service')

    const newCategory = { name: 'New Category' }
    const createdCategory = { id: '1', ...newCategory, tenant_id: 'tenant-1' }
    const singleMock = vi.fn().mockResolvedValue({ data: createdCategory, error: null })
    const selectMock = vi.fn(() => ({ single: singleMock }))
    const insertMock = vi.fn(() => ({ select: selectMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        insert: insertMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)
    ;(getTenantId as unknown as GetSupabaseMock).mockResolvedValue('tenant-1')

    const result = await categoriesService.create(newCategory)

    expect(result).toEqual(createdCategory)
    expect(insertMock).toHaveBeenCalled()
  })
})

describe('supabase-service suppliersService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getAll returns suppliers ordered by name', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { suppliersService } = await import('./supabase-service')

    const mockSuppliers = [{ id: '1', name: 'Supplier A' }]
    const orderMock = vi.fn().mockResolvedValue({ data: mockSuppliers, error: null })
    const selectMock = vi.fn(() => ({ order: orderMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        select: selectMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await suppliersService.getAll()

    expect(result).toEqual(mockSuppliers)
  })

  it('create inserts new supplier', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { suppliersService } = await import('./supabase-service')

    const newSupplier = { name: 'New Supplier' }
    const createdSupplier = { id: '1', ...newSupplier }
    const singleMock = vi.fn().mockResolvedValue({ data: createdSupplier, error: null })
    const selectMock = vi.fn(() => ({ single: singleMock }))
    const insertMock = vi.fn(() => ({ select: selectMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        insert: insertMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await suppliersService.create(newSupplier)

    expect(result).toEqual(createdSupplier)
  })

  it('update modifies existing supplier', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { suppliersService } = await import('./supabase-service')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-02T03:04:05.000Z'))

    const updates = { name: 'Updated Supplier' }
    const updatedSupplier = { id: '1', ...updates, updated_at: new Date().toISOString() }
    const singleMock = vi.fn().mockResolvedValue({ data: updatedSupplier, error: null })
    const selectMock = vi.fn(() => ({ single: singleMock }))
    const eqMock = vi.fn(() => ({ select: selectMock }))
    const updateMock = vi.fn(() => ({ eq: eqMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        update: updateMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await suppliersService.update('1', updates)

    expect(result).toEqual(updatedSupplier)
    vi.useRealTimers()
  })
})

describe('supabase-service customersService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getAll returns customers ordered by name', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { customersService } = await import('./supabase-service')

    const mockCustomers = [{ id: '1', name: 'Customer A' }]
    const orderMock = vi.fn().mockResolvedValue({ data: mockCustomers, error: null })
    const selectMock = vi.fn(() => ({ order: orderMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        select: selectMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await customersService.getAll()

    expect(result).toEqual(mockCustomers)
  })

  it('create inserts new customer', async () => {
    const { getSupabase } = await import('../lib/supabase')
    const { customersService } = await import('./supabase-service')

    const newCustomer = { name: 'New Customer' }
    const createdCustomer = { id: '1', ...newCustomer }
    const singleMock = vi.fn().mockResolvedValue({ data: createdCustomer, error: null })
    const selectMock = vi.fn(() => ({ single: singleMock }))
    const insertMock = vi.fn(() => ({ select: selectMock }))

    const supabaseClient = {
      from: vi.fn(() => ({
        insert: insertMock
      }))
    }
    ;(getSupabase as unknown as GetSupabaseMock).mockReturnValue(supabaseClient)

    const result = await customersService.create(newCustomer)

    expect(result).toEqual(createdCustomer)
  })
})



