/**
 * Routing Service Tests
 * 
 * Tests for Manufacturing Routing management functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseQuery),
    rpc: vi.fn(),
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('test-org-123')),
}))

import { supabase } from '@/lib/supabase'
import {
  routingService,
  type Routing,
  type RoutingOperation,
  type RoutingFormData,
  type OperationFormData,
  type RoutingTimeCalculation,
  type RoutingCostCalculation,
} from '../routingService'

describe('Routing Service', () => {
  const testOrgId = 'test-org-123'
  const testRoutingId = 'routing-123'
  const testOperationId = 'operation-123'

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset all mock implementations
    Object.keys(mockSupabaseQuery).forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockSupabaseQuery as any)[key].mockReturnThis()
    })
    // Reset RPC mock
    vi.mocked(supabase.rpc).mockClear()
  })

  describe('getRoutings', () => {
    it('should return empty array when no routings found', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null })

      const result = await routingService.getRoutings(testOrgId)

      expect(result).toEqual([])
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('org_id', testOrgId)
    })

    it('should return routings successfully', async () => {
      const mockRoutings: Partial<Routing>[] = [
        {
          id: testRoutingId,
          org_id: testOrgId,
          routing_code: 'RT-001',
          routing_name: 'Test Routing',
          status: 'DRAFT',
          is_active: true,
          version: 1,
          effective_date: '2024-01-01',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      mockSupabaseQuery.order.mockResolvedValue({ data: mockRoutings, error: null })

      const result = await routingService.getRoutings(testOrgId)

      expect(result).toHaveLength(1)
      expect(result[0].routing_code).toBe('RT-001')
    })

    it('should throw error when database error occurs', async () => {
      const mockError = { message: 'Database error', code: 'PGRST001' }
      mockSupabaseQuery.order.mockResolvedValue({ data: null, error: mockError })

      await expect(routingService.getRoutings(testOrgId)).rejects.toEqual(mockError)
    })
  })

  describe('getRoutingById', () => {
    it('should return null when routing not found', async () => {
      mockSupabaseQuery.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      })

      const result = await routingService.getRoutingById('non-existent-id')

      expect(result).toBeNull()
    })

    it('should return routing with operations', async () => {
      const mockRouting: Partial<Routing> = {
        id: testRoutingId,
        org_id: testOrgId,
        routing_code: 'RT-001',
        routing_name: 'Test Routing',
        status: 'DRAFT',
        is_active: true,
        version: 1,
        effective_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      mockSupabaseQuery.single.mockResolvedValueOnce({
        data: mockRouting,
        error: null,
      })

      // Mock getRoutingOperations
      mockSupabaseQuery.order.mockResolvedValueOnce({
        data: [],
        error: null,
      })

      const result = await routingService.getRoutingById(testRoutingId)

      expect(result).not.toBeNull()
      expect(result?.routing_code).toBe('RT-001')
    })
  })

  describe('createRouting', () => {
    it('should create routing with default values', async () => {
      const formData: RoutingFormData = {
        routing_code: 'RT-002',
        routing_name: 'New Routing',
        status: 'DRAFT',
      }

      const mockCreated: Partial<Routing> = {
        id: testRoutingId,
        org_id: testOrgId,
        ...formData,
        version: 1,
        is_active: true,
        effective_date: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockCreated,
        error: null,
      })

      const result = await routingService.createRouting(formData)

      expect(result.routing_code).toBe('RT-002')
      expect(result.version).toBe(1)
      expect(result.status).toBe('DRAFT')
      expect(result.is_active).toBe(true)
      expect(mockSupabaseQuery.insert).toHaveBeenCalled()
    })

    it('should create routing with custom values', async () => {
      const formData: RoutingFormData = {
        routing_code: 'RT-003',
        routing_name: 'Custom Routing',
        routing_name_ar: 'مسار مخصص',
        description: 'Test description',
        version: 2,
        status: 'APPROVED',
        is_active: false,
        effective_date: '2024-02-01',
      }

      const mockCreated: Partial<Routing> = {
        id: testRoutingId,
        org_id: testOrgId,
        ...formData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockCreated,
        error: null,
      })

      const result = await routingService.createRouting(formData)

      expect(result.version).toBe(2)
      expect(result.status).toBe('APPROVED')
      expect(result.is_active).toBe(false)
    })
  })

  describe('updateRouting', () => {
    it('should update routing successfully', async () => {
      const updates: Partial<RoutingFormData> = {
        routing_name: 'Updated Routing Name',
        status: 'APPROVED',
      }

      const mockUpdated: Partial<Routing> = {
        id: testRoutingId,
        org_id: testOrgId,
        routing_code: 'RT-001',
        routing_name: 'Updated Routing Name',
        status: 'APPROVED',
        is_active: true,
        version: 1,
        effective_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockUpdated,
        error: null,
      })

      const result = await routingService.updateRouting(testRoutingId, updates)

      expect(result.routing_name).toBe('Updated Routing Name')
      expect(result.status).toBe('APPROVED')
      expect(mockSupabaseQuery.update).toHaveBeenCalled()
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', testRoutingId)
    })
  })

  describe('deleteRouting', () => {
    it('should delete routing successfully', async () => {
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: null })

      await routingService.deleteRouting(testRoutingId)

      expect(mockSupabaseQuery.delete).toHaveBeenCalled()
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', testRoutingId)
    })
  })

  describe('approveRouting', () => {
    it('should approve routing successfully', async () => {
      const userId = 'user-123'
      const mockApproved: Partial<Routing> = {
        id: testRoutingId,
        org_id: testOrgId,
        routing_code: 'RT-001',
        routing_name: 'Test Routing',
        status: 'APPROVED',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        is_active: true,
        version: 1,
        effective_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockApproved,
        error: null,
      })

      const result = await routingService.approveRouting(testRoutingId, userId)

      expect(result.status).toBe('APPROVED')
      expect(result.approved_by).toBe(userId)
      expect(result.approved_at).toBeDefined()
    })
  })

  describe('getRoutingOperations', () => {
    it('should return operations for routing', async () => {
      const mockOperations: Partial<RoutingOperation>[] = [
        {
          id: testOperationId,
          org_id: testOrgId,
          routing_id: testRoutingId,
          operation_sequence: 1,
          operation_code: 'OP-001',
          operation_name: 'Operation 1',
          standard_setup_time: 30,
          standard_run_time_per_unit: 5,
          standard_queue_time: 10,
          standard_move_time: 5,
          time_unit: 'MINUTES',
          labor_rate_per_hour: 50,
          overhead_rate_per_hour: 30,
          operation_type: 'PRODUCTION',
          is_outsourced: false,
          requires_inspection: false,
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      mockSupabaseQuery.order.mockResolvedValue({
        data: mockOperations,
        error: null,
      })

      const result = await routingService.getRoutingOperations(testRoutingId)

      expect(result).toHaveLength(1)
      expect(result[0].operation_code).toBe('OP-001')
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('routing_id', testRoutingId)
    })
  })

  describe('createOperation', () => {
    it('should create operation with default values', async () => {
      const formData: OperationFormData = {
        routing_id: testRoutingId,
        operation_sequence: 1,
        operation_code: 'OP-001',
        operation_name: 'New Operation',
      }

      const mockCreated: Partial<RoutingOperation> = {
        id: testOperationId,
        org_id: testOrgId,
        ...formData,
        standard_setup_time: 0,
        standard_run_time_per_unit: 0,
        standard_queue_time: 0,
        standard_move_time: 0,
        time_unit: 'MINUTES',
        labor_rate_per_hour: 0,
        overhead_rate_per_hour: 0,
        operation_type: 'PRODUCTION',
        is_outsourced: false,
        requires_inspection: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockCreated,
        error: null,
      })

      const result = await routingService.createOperation(formData)

      expect(result.operation_code).toBe('OP-001')
      expect(result.standard_setup_time).toBe(0)
      expect(result.time_unit).toBe('MINUTES')
    })
  })

  describe('calculateRoutingTotals', () => {
    it('should calculate routing totals correctly', async () => {
      const quantity = 10
      const mockOperations: Partial<RoutingOperation>[] = [
        {
          id: testOperationId,
          org_id: testOrgId,
          routing_id: testRoutingId,
          operation_sequence: 1,
          operation_code: 'OP-001',
          operation_name: 'Operation 1',
          standard_setup_time: 30, // 30 minutes
          standard_run_time_per_unit: 5, // 5 minutes per unit
          standard_queue_time: 10, // 10 minutes
          standard_move_time: 5, // 5 minutes
          time_unit: 'MINUTES',
          labor_rate_per_hour: 50, // $50/hour
          overhead_rate_per_hour: 30, // $30/hour
          operation_type: 'PRODUCTION',
          is_outsourced: false,
          requires_inspection: false,
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      // Mock getRoutingOperations
      mockSupabaseQuery.order.mockResolvedValue({
        data: mockOperations,
        error: null,
      })

      const result = await routingService.calculateRoutingTotals(testRoutingId, quantity)

      // Expected calculations:
      // total_setup_time = 30
      // total_run_time = 5 * 10 = 50
      // total_queue_time = 10
      // total_move_time = 5
      // total_lead_time = 30 + 50 + 10 + 5 = 95
      // opTime = 30 + 50 = 80 minutes = 1.33 hours
      // total_labor_cost = 1.33 * 50 = 66.67
      // total_overhead_cost = 1.33 * 30 = 40
      // total_routing_cost = 66.67 + 40 = 106.67

      expect(result.time.total_setup_time).toBe(30)
      expect(result.time.total_run_time).toBe(50)
      expect(result.time.total_queue_time).toBe(10)
      expect(result.time.total_move_time).toBe(5)
      expect(result.time.total_lead_time).toBe(95)
      expect(result.cost.total_labor_cost).toBeCloseTo(66.67, 1)
      expect(result.cost.total_overhead_cost).toBeCloseTo(40, 1)
      expect(result.cost.total_routing_cost).toBeCloseTo(106.67, 1)
    })

    it('should skip inactive operations', async () => {
      const mockOperations: Partial<RoutingOperation>[] = [
        {
          id: testOperationId,
          org_id: testOrgId,
          routing_id: testRoutingId,
          operation_sequence: 1,
          operation_code: 'OP-001',
          operation_name: 'Active Operation',
          standard_setup_time: 30,
          standard_run_time_per_unit: 5,
          standard_queue_time: 10,
          standard_move_time: 5,
          time_unit: 'MINUTES',
          labor_rate_per_hour: 50,
          overhead_rate_per_hour: 30,
          operation_type: 'PRODUCTION',
          is_outsourced: false,
          requires_inspection: false,
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'operation-456',
          org_id: testOrgId,
          routing_id: testRoutingId,
          operation_sequence: 2,
          operation_code: 'OP-002',
          operation_name: 'Inactive Operation',
          standard_setup_time: 20,
          standard_run_time_per_unit: 3,
          standard_queue_time: 5,
          standard_move_time: 3,
          time_unit: 'MINUTES',
          labor_rate_per_hour: 40,
          overhead_rate_per_hour: 20,
          operation_type: 'PRODUCTION',
          is_outsourced: false,
          requires_inspection: false,
          is_active: false, // Inactive
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      mockSupabaseQuery.order.mockResolvedValue({
        data: mockOperations,
        error: null,
      })

      const result = await routingService.calculateRoutingTotals(testRoutingId, 10)

      // Should only include active operation
      expect(result.time.total_setup_time).toBe(30)
      expect(result.time.total_run_time).toBe(50)
    })
  })

  describe('calculateRoutingTime', () => {
    it('should return default values when RPC fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'RPC error' } as any,
      } as any)

      await expect(
        routingService.calculateRoutingTime(testRoutingId, 10)
      ).rejects.toMatchObject({ message: 'RPC error' })
    })

    it('should return calculated time from RPC', async () => {
      const mockTime: RoutingTimeCalculation = {
        total_setup_time: 30,
        total_run_time: 50,
        total_queue_time: 10,
        total_move_time: 5,
        total_lead_time: 95,
      }

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: [mockTime],
        error: null,
      } as any)

      const result = await routingService.calculateRoutingTime(testRoutingId, 10)

      expect(result).toEqual(mockTime)
      expect(supabase.rpc).toHaveBeenCalledWith('calculate_routing_total_time', {
        p_routing_id: testRoutingId,
        p_quantity: 10,
      })
    })
  })

  describe('calculateRoutingCost', () => {
    it('should return default values when RPC fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'RPC error' } as any,
      } as any)

      await expect(
        routingService.calculateRoutingCost(testRoutingId, 10)
      ).rejects.toMatchObject({ message: 'RPC error' })
    })

    it('should return calculated cost from RPC', async () => {
      const mockCost: RoutingCostCalculation = {
        total_labor_cost: 66.67,
        total_overhead_cost: 40,
        total_routing_cost: 106.67,
      }

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: [mockCost],
        error: null,
      } as any)

      const result = await routingService.calculateRoutingCost(testRoutingId, 10)

      expect(result).toEqual(mockCost)
      expect(supabase.rpc).toHaveBeenCalledWith('calculate_routing_standard_cost', {
        p_routing_id: testRoutingId,
        p_quantity: 10,
      })
    })
  })
})

