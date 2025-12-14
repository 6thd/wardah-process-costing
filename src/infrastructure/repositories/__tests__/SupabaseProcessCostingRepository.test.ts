/**
 * Integration Tests for Clean Architecture Infrastructure
 * 
 * اختبارات طبقة البنية التحتية (Repository + DI Container)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

// Import after mocks
import { SupabaseProcessCostingRepository } from '../SupabaseProcessCostingRepository'
import { supabase } from '@/lib/supabase'

describe('SupabaseProcessCostingRepository', () => {
  let repository: SupabaseProcessCostingRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repository = new SupabaseProcessCostingRepository()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================
  // getDirectMaterials Tests
  // ============================================
  describe('getDirectMaterials', () => {
    it('should fetch and map materials correctly', async () => {
      const mockData = [
        {
          id: 'mat-001',
          item_id: 'item-001',
          quantity: 100,
          unit_cost: 10,
          total_cost: 1000,
          products: { name: 'Raw Material A' },
        },
        {
          id: 'mat-002',
          item_id: 'item-002',
          quantity: 50,
          unit_cost: 20,
          total_cost: 1000,
          products: { name: 'Raw Material B' },
        },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockData, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getDirectMaterials('MO-001')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        id: 'mat-001',
        itemId: 'item-001',
        itemName: 'Raw Material A',
        quantity: 100,
        unitCost: 10,
        totalCost: 1000,
      })
      expect(supabase.from).toHaveBeenCalledWith('mo_material_issues')
    })

    it('should handle empty data', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getDirectMaterials('MO-001')

      expect(result).toEqual([])
    })

    it('should return empty array on database failure', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ 
          data: null, 
          error: { message: 'Database error' } 
        }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getDirectMaterials('MO-001')
      expect(result).toEqual([])
    })

    it('should handle null product name', async () => {
      const mockData = [
        {
          id: 'mat-001',
          item_id: 'item-001',
          quantity: 100,
          unit_cost: 10,
          total_cost: 1000,
          products: null,
        },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockData, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getDirectMaterials('MO-001')

      expect(result[0].itemName).toBe('Unknown')
    })
  })

  // ============================================
  // getDirectLabor Tests
  // ============================================
  describe('getDirectLabor', () => {
    it('should fetch and map labor correctly', async () => {
      const mockData = [
        {
          id: 'labor-001',
          employee_id: 'emp-001',
          employee_name: 'John Doe',
          hours: 8,
          hourly_rate: 50,
          total_cost: 400,
        },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockData, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getDirectLabor('MO-001')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 'labor-001',
        employeeId: 'emp-001',
        employeeName: 'John Doe',
        hours: 8,
        hourlyRate: 50,
        totalCost: 400,
      })
      expect(supabase.from).toHaveBeenCalledWith('labor_time_logs')
    })

    it('should handle null values', async () => {
      const mockData = [
        {
          id: 'labor-001',
          employee_id: null,
          employee_name: undefined,
          hours: null,
          hourly_rate: null,
          total_cost: null,
        },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockData, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getDirectLabor('MO-001')

      expect(result[0]).toEqual({
        id: 'labor-001',
        employeeId: null,
        employeeName: undefined,
        hours: 0,
        hourlyRate: 0,
        totalCost: 0,
      })
    })

    it('should return empty array on database failure', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ 
          data: null, 
          error: { message: 'Database error' } 
        }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getDirectLabor('MO-001')
      expect(result).toEqual([])
    })
  })

  // ============================================
  // getOverheadCosts Tests
  // ============================================
  describe('getOverheadCosts', () => {
    it('should fetch and map overhead costs correctly', async () => {
      const mockData = [
        {
          id: 'oh-001',
          overhead_type: 'Utilities',
          notes: 'Electricity',
          amount: 500,
          allocation_base: 'Machine Hours',
          overhead_rate: 10,
        },
        {
          id: 'oh-002',
          overhead_type: 'Maintenance',
          notes: 'Equipment maintenance',
          amount: 300,
          allocation_base: null,
          overhead_rate: null,
        },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockData, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getOverheadCosts('MO-001')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        id: 'oh-001',
        type: 'Utilities',
        description: 'Electricity',
        amount: 500,
        allocationBase: 'Machine Hours',
        allocationRate: 10,
      })
      expect(supabase.from).toHaveBeenCalledWith('moh_applied')
    })

    it('should default type to variable when overhead_type is null', async () => {
      const mockData = [
        {
          id: 'oh-001',
          overhead_type: null,
          notes: 'General expense',
          amount: 100,
        },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockData, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getOverheadCosts('MO-001')

      expect(result[0].type).toBe('variable')
    })

    it('should return empty array on database failure', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ 
          data: null, 
          error: { message: 'Database error' } 
        }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getOverheadCosts('MO-001')
      expect(result).toEqual([])
    })
  })

  // ============================================
  // getManufacturingOrderQuantity Tests
  // ============================================
  describe('getManufacturingOrderQuantity', () => {
    it('should fetch MO quantity correctly', async () => {
      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ 
        data: { quantity: 1000 }, 
        error: null 
      })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getManufacturingOrderQuantity('MO-001')

      expect(result).toBe(1000)
      expect(supabase.from).toHaveBeenCalledWith('manufacturing_orders')
    })

    it('should return 0 for null quantity', async () => {
      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ 
        data: { quantity: null }, 
        error: null 
      })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getManufacturingOrderQuantity('MO-001')

      expect(result).toBe(0)
    })

    it('should return 0 on database failure', async () => {
      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ 
        data: null, 
        error: { message: 'Not found' } 
      })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getManufacturingOrderQuantity('MO-001')
      expect(result).toBe(0)
    })
  })
})

// ============================================
// DI Container Tests
// ============================================
describe('DI Container', () => {
  it('Container class should work with singletons', () => {
    // Create a simple container for testing
    class TestContainer {
      private instances: Map<string, any> = new Map()
      
      registerSingleton<T>(key: string, instance: T): void {
        this.instances.set(key, instance)
      }
      
      resolve<T>(key: string): T {
        if (this.instances.has(key)) {
          return this.instances.get(key)
        }
        throw new Error(`الخدمة غير مسجلة: ${key}`)
      }
      
      reset(): void {
        this.instances.clear()
      }
    }
    
    const testContainer = new TestContainer()
    const testService = { name: 'TestService' }
    
    testContainer.registerSingleton('TestService', testService)
    const resolved = testContainer.resolve<{ name: string }>('TestService')
    
    expect(resolved).toBe(testService)
    expect(resolved.name).toBe('TestService')
  })

  it('Container should throw for unregistered services', () => {
    class TestContainer {
      private instances: Map<string, any> = new Map()
      
      resolve<T>(key: string): T {
        if (this.instances.has(key)) {
          return this.instances.get(key)
        }
        throw new Error(`الخدمة غير مسجلة: ${key}`)
      }
    }
    
    const testContainer = new TestContainer()
    
    expect(() => testContainer.resolve('Unknown'))
      .toThrow('الخدمة غير مسجلة: Unknown')
  })

  it('Container should support factory registration', () => {
    class TestContainer {
      private instances: Map<string, any> = new Map()
      private factories: Map<string, () => any> = new Map()
      
      registerFactory<T>(key: string, factory: () => T): void {
        this.factories.set(key, factory)
      }
      
      resolve<T>(key: string): T {
        if (this.instances.has(key)) {
          return this.instances.get(key)
        }
        if (this.factories.has(key)) {
          const instance = this.factories.get(key)!()
          this.instances.set(key, instance)
          return instance
        }
        throw new Error(`الخدمة غير مسجلة: ${key}`)
      }
    }
    
    const testContainer = new TestContainer()
    let callCount = 0
    
    testContainer.registerFactory('CounterService', () => {
      callCount++
      return { count: callCount }
    })
    
    const first = testContainer.resolve<{ count: number }>('CounterService')
    const second = testContainer.resolve<{ count: number }>('CounterService')
    
    expect(first.count).toBe(1)
    expect(second.count).toBe(1) // Same instance (cached)
    expect(callCount).toBe(1) // Factory called only once
  })
})
