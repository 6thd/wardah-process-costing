/**
 * Test Utilities
 * Mock factories and assertion helpers for Wardah ERP tests
 */

import { vi } from 'vitest'

// ===================================================================
// Mock Factories
// ===================================================================

export const factories = {
  /**
   * Create a mock GL Account
   */
  glAccount: (overrides = {}) => ({
    id: 'test-account-id',
    code: '1000',
    name: 'Cash',
    name_ar: 'نقد',
    category: 'ASSET',
    parent_id: null,
    org_id: 'test-org-id',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides
  }),

  /**
   * Create a mock Product
   */
  product: (overrides = {}) => ({
    id: 'test-product-id',
    code: 'PROD001',
    name: 'Test Product',
    stock_quantity: 100,
    cost_price: 10,
    stock_value: 1000,
    valuation_method: 'AVCO',
    stock_queue: [],
    ...overrides
  }),

  /**
   * Create a mock Purchase Order
   */
  purchaseOrder: (overrides = {}) => ({
    id: 'test-po-id',
    supplier_id: 'test-supplier-id',
    status: 'DRAFT',
    order_number: 'PO-001',
    order_date: '2024-12-01',
    total_amount: 1000,
    items: [],
    ...overrides
  }),

  /**
   * Create a mock User
   */
  user: (overrides = {}) => ({
    id: 'test-user-id',
    email: 'test@example.com',
    role: 'accountant',
    tenant_id: 'test-tenant-id',
    name: 'Test User',
    ...overrides
  }),

  /**
   * Create a mock GL Entry
   */
  glEntry: (overrides = {}) => ({
    id: 'test-entry-id',
    date: '2024-12-01',
    reference: 'TEST-REF-001',
    description: 'Test Entry',
    lines: [
      { account: '1000', debit: 100, credit: 0 },
      { account: '4000', debit: 0, credit: 100 }
    ],
    status: 'DRAFT',
    created_by: 'test-user-id',
    ...overrides
  }),

  /**
   * Create a mock Manufacturing Order
   */
  manufacturingOrder: (overrides = {}) => ({
    id: 'test-mo-id',
    item_id: 'test-item-id',
    quantity: 100,
    status: 'pending',
    order_number: 'MO-001',
    created_at: '2024-12-01T00:00:00Z',
    ...overrides
  }),

  /**
   * Create a mock Supplier
   */
  supplier: (overrides = {}) => ({
    id: 'test-supplier-id',
    name: 'Test Supplier',
    code: 'SUP001',
    email: 'supplier@example.com',
    phone: '+966501234567',
    ...overrides
  }),

  /**
   * Create a mock Customer
   */
  customer: (overrides = {}) => ({
    id: 'test-customer-id',
    name: 'Test Customer',
    code: 'CUST001',
    email: 'customer@example.com',
    phone: '+966501234567',
    ...overrides
  })
}

// ===================================================================
// Assertion Helpers
// ===================================================================

export const assertions = {
  /**
   * Assert that debits equal credits in a GL entry
   */
  toBalanceDebitsCredits: (entry: { lines: Array<{ debit: number; credit: number }> }) => {
    const debits = entry.lines.reduce((sum, line) => sum + (line.debit || 0), 0)
    const credits = entry.lines.reduce((sum, line) => sum + (line.credit || 0), 0)
    if (Math.abs(debits - credits) > 0.01) {
      throw new Error(
        `Entry is unbalanced: Debits (${debits}) != Credits (${credits})`
      )
    }
  },

  /**
   * Assert that a GL entry is valid
   */
  toBeValidGLEntry: (entry: any) => {
    if (!entry.id) throw new Error('Entry must have an id')
    if (!entry.date) throw new Error('Entry must have a date')
    if (!entry.lines || entry.lines.length === 0) {
      throw new Error('Entry must have at least one line')
    }
    assertions.toBalanceDebitsCredits(entry)
  },

  /**
   * Assert that a date is in valid format
   */
  toBeValidDate: (date: string) => {
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`Invalid date format: ${date}`)
    }
  },

  /**
   * Assert that a UUID is valid
   */
  toBeValidUUID: (uuid: string) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(uuid)) {
      throw new Error(`Invalid UUID format: ${uuid}`)
    }
  }
}

// ===================================================================
// Mock Helpers
// ===================================================================

/**
 * Create a mock Supabase client
 * NOSONAR - Nested functions are required for Supabase query builder pattern
 */
export const createMockSupabaseClient = () => {
  const mockData: Record<string, any[]> = {}
  
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn((columns = '*') => ({
        eq: vi.fn((column: string, value: any) => ({
          neq: vi.fn((column: string, value: any) => ({ // NOSONAR - Required for query builder pattern
            single: vi.fn(() => Promise.resolve({ 
              data: mockData[table]?.[0] || null, 
              error: null 
            })),
            limit: vi.fn((count: number) => Promise.resolve({ 
              data: (mockData[table] || []).slice(0, count), 
              error: null 
            })),
            order: vi.fn((column: string, options?: { ascending?: boolean }) => 
              Promise.resolve({ 
                data: mockData[table] || [], 
                error: null 
              })
            )
          })),
          single: vi.fn(() => Promise.resolve({ 
            data: mockData[table]?.find((item: any) => item[column] === value) || null, 
            error: null 
          })),
          limit: vi.fn((count: number) => Promise.resolve({ 
            data: (mockData[table] || []).filter((item: any) => item[column] === value).slice(0, count), 
            error: null 
          })),
          order: vi.fn((column: string, options?: { ascending?: boolean }) => 
            Promise.resolve({ 
              data: (mockData[table] || []).filter((item: any) => item[column] === value), 
              error: null 
            })
          )
        })),
        limit: vi.fn((count: number) => Promise.resolve({ 
          data: (mockData[table] || []).slice(0, count), 
          error: null 
        })),
        order: vi.fn((column: string, options?: { ascending?: boolean }) => 
          Promise.resolve({ 
            data: mockData[table] || [], 
            error: null 
          })
        )
      })),
      insert: vi.fn((data: any) => {
        const newItem = Array.isArray(data) ? data[0] : data
        if (!mockData[table]) mockData[table] = []
        mockData[table].push(newItem)
        return Promise.resolve({ data: [newItem], error: null })
      }),
      update: vi.fn((data: any) => ({
        eq: vi.fn((column: string, value: any) => {
          if (!mockData[table]) mockData[table] = []
          const index = mockData[table].findIndex((item: any) => item[column] === value)
          if (index !== -1) {
            mockData[table][index] = { ...mockData[table][index], ...data }
            return Promise.resolve({ data: [mockData[table][index]], error: null })
          }
          return Promise.resolve({ data: [], error: null })
        })
      })),
      delete: vi.fn(() => ({
        eq: vi.fn((column: string, value: any) => {
          if (!mockData[table]) mockData[table] = []
          const index = mockData[table].findIndex((item: any) => item[column] === value)
          if (index !== -1) {
            mockData[table].splice(index, 1)
            return Promise.resolve({ data: [], error: null })
          }
          return Promise.resolve({ data: [], error: null })
        })
      })),
      upsert: vi.fn((data: any) => {
        const newItem = Array.isArray(data) ? data[0] : data
        if (!mockData[table]) mockData[table] = []
        const index = mockData[table].findIndex((item: any) => item.id === newItem.id)
        if (index >= 0) {
          mockData[table][index] = newItem
        } else {
          mockData[table].push(newItem)
        }
        return Promise.resolve({ data: [newItem], error: null })
      })
    })),
    rpc: vi.fn((functionName: string, params: any) => {
      return Promise.resolve({ data: null, error: null })
    }),
    auth: {
      getSession: vi.fn(() => Promise.resolve({
        data: {
          session: {
            access_token: 'mock-token',
            user: {
              id: 'test-user-id',
              email: 'test@example.com'
            }
          }
        },
        error: null
      }))
    },
    // Helper to set mock data
    _setMockData: (table: string, data: any[]) => {
      mockData[table] = data
    },
    // Helper to clear mock data
    _clearMockData: () => {
      Object.keys(mockData).forEach(key => delete mockData[key])
    }
  }
}

/**
 * Create a mock audit logger
 */
export const createMockAuditLogger = () => ({
  logAuditEvent: vi.fn(),
  getAuditLog: vi.fn(() => Promise.resolve([])),
  getAuditRecord: vi.fn(() => Promise.resolve(null))
})

// ===================================================================
// Test Data Helpers
// ===================================================================

/**
 * Clear all test data
 */
export const clearTestData = async () => {
  // Implementation depends on test database setup
  // For now, just clear mocks
  vi.clearAllMocks()
}

/**
 * Seed test data
 */
export const seedTestData = async (data?: Record<string, any[]>) => {
  // Implementation depends on test database setup
  // For now, just return
  return
}

