/**
 * MES Service Tests
 * 
 * Tests for Manufacturing Execution System functionality
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
  mesService,
  type WorkOrder,
  type WorkOrderStatus,
  type OperationExecutionLog,
  type OperationEventType,
} from '../mesService'

describe('MES Service', () => {
  const testOrgId = 'test-org-123'
  const testWorkOrderId = 'wo-123'
  const testMoId = 'mo-123'
  const testWorkCenterId = 'wc-123'

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset all mock implementations
    Object.keys(mockSupabaseQuery).forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockSupabaseQuery as any)[key].mockReturnThis()
    })
  })

  describe('getWorkOrders', () => {
    it('should return empty array when no work orders found', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null })

      const result = await mesService.getWorkOrders()

      expect(result).toEqual([])
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('org_id', testOrgId)
    })

    it('should return work orders with filters', async () => {
      const mockWorkOrders: Partial<WorkOrder>[] = [
        {
          id: testWorkOrderId,
          org_id: testOrgId,
          mo_id: testMoId,
          work_center_id: testWorkCenterId,
          work_order_number: 'WO-001',
          operation_sequence: 1,
          operation_name: 'Operation 1',
          planned_quantity: 100,
          completed_quantity: 0,
          scrapped_quantity: 0,
          planned_setup_time: 30,
          planned_run_time: 500,
          actual_setup_time: 0,
          actual_run_time: 0,
          actual_wait_time: 0,
          status: 'PENDING',
          priority: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      mockSupabaseQuery.order.mockResolvedValue({
        data: mockWorkOrders,
        error: null,
      })

      const result = await mesService.getWorkOrders({
        moId: testMoId,
        workCenterId: testWorkCenterId,
        status: 'PENDING',
      })

      expect(result).toHaveLength(1)
      expect(result[0].work_order_number).toBe('WO-001')
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('mo_id', testMoId)
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('work_center_id', testWorkCenterId)
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('status', 'PENDING')
    })

    it('should filter by multiple statuses', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null })

      await mesService.getWorkOrders({
        status: ['PENDING', 'IN_PROGRESS'],
      })

      expect(mockSupabaseQuery.in).toHaveBeenCalledWith('status', ['PENDING', 'IN_PROGRESS'])
    })

    it('should filter by date range', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null })

      await mesService.getWorkOrders({
        fromDate: '2024-01-01',
        toDate: '2024-01-31',
      })

      expect(mockSupabaseQuery.gte).toHaveBeenCalledWith('planned_start_date', '2024-01-01')
      expect(mockSupabaseQuery.lte).toHaveBeenCalledWith('planned_end_date', '2024-01-31')
    })
  })

  describe('getWorkOrderById', () => {
    it('should return null when work order not found', async () => {
      mockSupabaseQuery.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      })

      const result = await mesService.getWorkOrderById('non-existent-id')

      expect(result).toBeNull()
    })

    it('should return work order successfully', async () => {
      const mockWorkOrder: Partial<WorkOrder> = {
        id: testWorkOrderId,
        org_id: testOrgId,
        mo_id: testMoId,
        work_center_id: testWorkCenterId,
        work_order_number: 'WO-001',
        operation_sequence: 1,
        operation_name: 'Operation 1',
        planned_quantity: 100,
        completed_quantity: 0,
        scrapped_quantity: 0,
        planned_setup_time: 30,
        planned_run_time: 500,
        actual_setup_time: 0,
        actual_run_time: 0,
        actual_wait_time: 0,
        status: 'PENDING',
        priority: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      // @ts-ignore - Mock response for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSupabaseQuery.single.mockResolvedValue({
        data: mockWorkOrder,
        error: null,
      } as any)

      const result = await mesService.getWorkOrderById(testWorkOrderId)

      expect(result).not.toBeNull()
      expect(result?.work_order_number).toBe('WO-001')
    })
  })

  describe('generateWorkOrdersFromMO', () => {
    it('should generate work orders from manufacturing order', async () => {
      const mockWorkOrders: Partial<WorkOrder>[] = [
        {
          id: testWorkOrderId,
          org_id: testOrgId,
          mo_id: testMoId,
          work_center_id: testWorkCenterId,
          work_order_number: 'WO-001',
          operation_sequence: 1,
          operation_name: 'Operation 1',
          planned_quantity: 100,
          completed_quantity: 0,
          scrapped_quantity: 0,
          planned_setup_time: 30,
          planned_run_time: 500,
          actual_setup_time: 0,
          actual_run_time: 0,
          actual_wait_time: 0,
          status: 'PENDING',
          priority: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: mockWorkOrders,
        error: null,
      } as any)

      const result = await mesService.generateWorkOrdersFromMO(testMoId)

      expect(result).toHaveLength(1)
      expect(result[0].work_order_number).toBe('WO-001')
      expect(supabase.rpc).toHaveBeenCalledWith('generate_work_orders_from_mo', {
        p_mo_id: testMoId,
      })
    })
  })

  describe('startOperation', () => {
    it('should start operation with setup', async () => {
      const operatorId = 'operator-123'
      const mockWorkOrder: Partial<WorkOrder> = {
        id: testWorkOrderId,
        org_id: testOrgId,
        mo_id: testMoId,
        work_center_id: testWorkCenterId,
        work_order_number: 'WO-001',
        operation_sequence: 1,
        operation_name: 'Operation 1',
        status: 'IN_SETUP',
        current_operator_id: operatorId,
        actual_start_date: new Date().toISOString(),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      // @ts-ignore - Mock response for testing
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: mockWorkOrder,
        error: null,
      } as any)

      const result = await mesService.startOperation(testWorkOrderId, operatorId, true)

      expect(result.status).toBe('IN_SETUP')
      expect(result.current_operator_id).toBe(operatorId)
      expect(supabase.rpc).toHaveBeenCalledWith('start_operation', {
        p_work_order_id: testWorkOrderId,
        p_operator_id: operatorId,
        p_is_setup: true,
      })
    })

    it('should start operation without setup', async () => {
      const mockWorkOrder: Partial<WorkOrder> = {
        id: testWorkOrderId,
        org_id: testOrgId,
        mo_id: testMoId,
        work_center_id: testWorkCenterId,
        work_order_number: 'WO-001',
        operation_sequence: 1,
        operation_name: 'Operation 1',
        status: 'IN_PROGRESS',
        actual_start_date: new Date().toISOString(),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      // @ts-ignore - Mock response for testing
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: mockWorkOrder,
        error: null,
      } as any)

      const result = await mesService.startOperation(testWorkOrderId, undefined, false)

      expect(result.status).toBe('IN_PROGRESS')
      expect(supabase.rpc).toHaveBeenCalledWith('start_operation', {
        p_work_order_id: testWorkOrderId,
        p_operator_id: undefined,
        p_is_setup: false,
      })
    })
  })

  describe('completeOperation', () => {
    it('should complete operation successfully', async () => {
      const quantityProduced = 95
      const quantityScrapped = 5
      const notes = 'Completed successfully'

      const mockWorkOrder: Partial<WorkOrder> = {
        id: testWorkOrderId,
        org_id: testOrgId,
        mo_id: testMoId,
        work_center_id: testWorkCenterId,
        work_order_number: 'WO-001',
        operation_sequence: 1,
        operation_name: 'Operation 1',
        planned_quantity: 100,
        completed_quantity: quantityProduced,
        scrapped_quantity: quantityScrapped,
        status: 'COMPLETED',
        actual_end_date: new Date().toISOString(),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      // @ts-ignore - Mock response for testing
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: mockWorkOrder,
        error: null,
      } as any)

      const result = await mesService.completeOperation(
        testWorkOrderId,
        quantityProduced,
        quantityScrapped,
        notes
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.completed_quantity).toBe(quantityProduced)
      expect(result.scrapped_quantity).toBe(quantityScrapped)
      expect(supabase.rpc).toHaveBeenCalledWith('complete_operation', {
        p_work_order_id: testWorkOrderId,
        p_quantity_produced: quantityProduced,
        p_quantity_scrapped: quantityScrapped,
        p_notes: notes,
      })
    })

    it('should complete operation with default scrapped quantity', async () => {
      const quantityProduced = 100

      const mockWorkOrder: Partial<WorkOrder> = {
        id: testWorkOrderId,
        org_id: testOrgId,
        mo_id: testMoId,
        work_center_id: testWorkCenterId,
        work_order_number: 'WO-001',
        operation_sequence: 1,
        operation_name: 'Operation 1',
        planned_quantity: 100,
        completed_quantity: quantityProduced,
        scrapped_quantity: 0,
        status: 'COMPLETED',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      // @ts-ignore - Mock response for testing
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: mockWorkOrder,
        error: null,
      } as any)

      const result = await mesService.completeOperation(testWorkOrderId, quantityProduced)

      expect(result.completed_quantity).toBe(quantityProduced)
      expect(result.scrapped_quantity).toBe(0)
      expect(supabase.rpc).toHaveBeenCalledWith('complete_operation', {
        p_work_order_id: testWorkOrderId,
        p_quantity_produced: quantityProduced,
        p_quantity_scrapped: 0,
        p_notes: undefined,
      })
    })
  })

  describe('updateWorkOrderStatus', () => {
    it('should update work order status', async () => {
      const newStatus: WorkOrderStatus = 'ON_HOLD'
      const notes = 'Paused for material shortage'

      const mockWorkOrder: Partial<WorkOrder> = {
        id: testWorkOrderId,
        org_id: testOrgId,
        mo_id: testMoId,
        work_center_id: testWorkCenterId,
        work_order_number: 'WO-001',
        operation_sequence: 1,
        operation_name: 'Operation 1',
        status: newStatus,
        notes,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      // @ts-ignore - Mock response for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSupabaseQuery.single.mockResolvedValue({
        data: mockWorkOrder,
        error: null,
      } as any)

      const result = await mesService.updateWorkOrderStatus(testWorkOrderId, newStatus, notes)

      expect(result.status).toBe(newStatus)
      expect(result.notes).toBe(notes)
      expect(mockSupabaseQuery.update).toHaveBeenCalled()
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', testWorkOrderId)
    })
  })

  describe('pauseWorkOrder', () => {
    it('should pause work order with reason', async () => {
      const reason = 'Material shortage'

      const mockWorkOrder: Partial<WorkOrder> = {
        id: testWorkOrderId,
        org_id: testOrgId,
        mo_id: testMoId,
        work_center_id: testWorkCenterId,
        work_order_number: 'WO-001',
        operation_sequence: 1,
        operation_name: 'Operation 1',
        status: 'ON_HOLD',
        notes: reason,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      // @ts-ignore - Mock response for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSupabaseQuery.single.mockResolvedValue({
        data: mockWorkOrder,
        error: null,
      } as any)

      const result = await mesService.pauseWorkOrder(testWorkOrderId, reason)

      expect(result.status).toBe('ON_HOLD')
      expect(result.notes).toBe(reason)
    })
  })

  describe('resumeWorkOrder', () => {
    it('should resume paused work order', async () => {
      const mockWorkOrder: Partial<WorkOrder> = {
        id: testWorkOrderId,
        org_id: testOrgId,
        mo_id: testMoId,
        work_center_id: testWorkCenterId,
        work_order_number: 'WO-001',
        operation_sequence: 1,
        operation_name: 'Operation 1',
        status: 'IN_PROGRESS',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      // @ts-ignore - Mock response for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSupabaseQuery.single.mockResolvedValue({
        data: mockWorkOrder,
        error: null,
      } as any)

      const result = await mesService.resumeWorkOrder(testWorkOrderId)

      expect(result.status).toBe('IN_PROGRESS')
    })
  })

  describe('logOperationEvent', () => {
    it('should log operation event', async () => {
      const eventType: OperationEventType = 'PRODUCTION_START'
      const operatorId = 'operator-123'

      const mockLog: Partial<OperationExecutionLog> = {
        id: 'log-123',
        org_id: testOrgId,
        work_order_id: testWorkOrderId,
        event_type: eventType,
        operator_id: operatorId,
        event_timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockLog,
        error: null,
      })

      const result = await mesService.addOperationLog(testWorkOrderId, eventType, {
        notes: `Operator ${operatorId} started production`,
      })

      expect(result.event_type).toBe(eventType)
      expect(result.operator_id).toBe(operatorId)
      expect(mockSupabaseQuery.insert).toHaveBeenCalled()
    })
  })
})

