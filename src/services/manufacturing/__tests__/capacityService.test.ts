/**
 * Capacity Service Tests
 * 
 * Tests for Capacity Planning functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
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
  capacityService,
  type WorkCenterCalendar,
  type WorkCenterLoad,
  type ProductionSchedule,
  type ScheduleDetail,
  type CapacityCalculation,
  type LoadCalculation,
  type BottleneckAnalysis,
} from '../capacityService'

describe('Capacity Service', () => {
  const testOrgId = 'test-org-123'
  const testWorkCenterId = 'wc-123'
  const testScheduleId = 'schedule-123'
  const testWorkOrderId = 'wo-123'

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset all mock implementations
    Object.keys(mockSupabaseQuery).forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockSupabaseQuery as any)[key].mockReturnThis()
    })
  })

  describe('getWorkCenterCalendar', () => {
    it('should return calendar for work center', async () => {
      const startDate = '2024-01-01'
      const endDate = '2024-01-31'

      const mockCalendar: Partial<WorkCenterCalendar>[] = [
        {
          id: 'cal-123',
          org_id: testOrgId,
          work_center_id: testWorkCenterId,
          calendar_date: '2024-01-01',
          available_hours: 8,
          planned_maintenance_hours: 0,
          shift_count: 1,
          is_working_day: true,
          is_holiday: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      mockSupabaseQuery.order.mockResolvedValue({
        data: mockCalendar,
        error: null,
      })

      const result = await capacityService.getWorkCenterCalendar(
        testWorkCenterId,
        startDate,
        endDate
      )

      expect(result).toHaveLength(1)
      expect(result[0].available_hours).toBe(8)
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('work_center_id', testWorkCenterId)
      expect(mockSupabaseQuery.gte).toHaveBeenCalledWith('calendar_date', startDate)
      expect(mockSupabaseQuery.lte).toHaveBeenCalledWith('calendar_date', endDate)
    })
  })

  describe('updateCalendarDay', () => {
    it('should update calendar day', async () => {
      const date = '2024-01-01'
      const updates = {
        available_hours: 6,
        planned_maintenance_hours: 2,
        is_working_day: true,
      }

      const mockUpdated: Partial<WorkCenterCalendar> = {
        id: 'cal-123',
        org_id: testOrgId,
        work_center_id: testWorkCenterId,
        calendar_date: date,
        ...updates,
        shift_count: 1,
        is_holiday: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockUpdated,
        error: null,
      })

      const result = await capacityService.updateCalendarDay(testWorkCenterId, date, updates)

      expect(result.available_hours).toBe(6)
      expect(result.planned_maintenance_hours).toBe(2)
      expect(mockSupabaseQuery.upsert).toHaveBeenCalled()
    })
  })

  describe('addHoliday', () => {
    it('should add holiday to calendar', async () => {
      const date = '2024-01-01'
      const holidayName = 'New Year'

      const mockHoliday: Partial<WorkCenterCalendar> = {
        id: 'cal-123',
        org_id: testOrgId,
        work_center_id: testWorkCenterId,
        calendar_date: date,
        available_hours: 0,
        planned_maintenance_hours: 0,
        shift_count: 0,
        is_working_day: false,
        is_holiday: true,
        holiday_name: holidayName,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockHoliday,
        error: null,
      })

      const result = await capacityService.addHoliday(testWorkCenterId, date, holidayName)

      expect(result.is_holiday).toBe(true)
      expect(result.is_working_day).toBe(false)
      expect(result.holiday_name).toBe(holidayName)
      expect(result.available_hours).toBe(0)
    })
  })

  describe('addPlannedMaintenance', () => {
    it('should add planned maintenance', async () => {
      const date = '2024-01-01'
      const maintenanceHours = 4
      const notes = 'Scheduled maintenance'

      const mockMaintenance: Partial<WorkCenterCalendar> = {
        id: 'cal-123',
        org_id: testOrgId,
        work_center_id: testWorkCenterId,
        calendar_date: date,
        available_hours: 4,
        planned_maintenance_hours: maintenanceHours,
        shift_count: 1,
        is_working_day: true,
        is_holiday: false,
        notes,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockMaintenance,
        error: null,
      })

      const result = await capacityService.addPlannedMaintenance(
        testWorkCenterId,
        date,
        maintenanceHours,
        notes
      )

      expect(result.planned_maintenance_hours).toBe(maintenanceHours)
      expect(result.notes).toBe(notes)
    })
  })

  describe('calculateAvailableCapacity', () => {
    it('should return default values when RPC fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'RPC error' } as any,
      } as any)

      await expect(
        capacityService.calculateAvailableCapacity(testWorkCenterId, '2024-01-01', '2024-01-31')
      ).rejects.toMatchObject({ message: 'RPC error' })
    })

    it('should return calculated capacity from RPC', async () => {
      const mockCapacity: CapacityCalculation = {
        total_available_hours: 160,
        working_days: 20,
        avg_daily_hours: 8,
      }

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: [mockCapacity],
        error: null,
      } as any)

      const result = await capacityService.calculateAvailableCapacity(
        testWorkCenterId,
        '2024-01-01',
        '2024-01-31'
      )

      expect(result).toEqual(mockCapacity)
      expect(supabase.rpc).toHaveBeenCalledWith('calculate_available_capacity', {
        p_work_center_id: testWorkCenterId,
        p_start_date: '2024-01-01',
        p_end_date: '2024-01-31',
      })
    })
  })

  describe('calculatePlannedLoad', () => {
    it('should return default values when RPC fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'RPC error' } as any,
      } as any)

      await expect(
        capacityService.calculatePlannedLoad(testWorkCenterId, '2024-01-01', '2024-01-31')
      ).rejects.toMatchObject({ message: 'RPC error' })
    })

    it('should return calculated load from RPC', async () => {
      const mockLoad: LoadCalculation = {
        total_planned_hours: 120,
        total_work_orders: 15,
        pending_work_orders: 5,
        in_progress_work_orders: 10,
      }

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: [mockLoad],
        error: null,
      } as any)

      const result = await capacityService.calculatePlannedLoad(
        testWorkCenterId,
        '2024-01-01',
        '2024-01-31'
      )

      expect(result).toEqual(mockLoad)
      expect(supabase.rpc).toHaveBeenCalledWith('calculate_planned_load', {
        p_work_center_id: testWorkCenterId,
        p_start_date: '2024-01-01',
        p_end_date: '2024-01-31',
      })
    })
  })

  describe('getWorkCenterLoads', () => {
    it('should return work center loads', async () => {
      const startDate = '2024-01-01'
      const endDate = '2024-01-31'

      const mockLoads: Partial<WorkCenterLoad>[] = [
        {
          id: 'load-123',
          org_id: testOrgId,
          work_center_id: testWorkCenterId,
          period_start: startDate,
          period_end: endDate,
          available_capacity_hours: 160,
          planned_load_hours: 120,
          actual_load_hours: 0,
          utilization_pct: 75,
          efficiency_pct: 100,
          planned_work_orders: 15,
          completed_work_orders: 0,
          status: 'PLANNED',
          calculated_at: new Date().toISOString(),
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      mockSupabaseQuery.order.mockResolvedValue({
        data: mockLoads,
        error: null,
      })

      const result = await capacityService.getWorkCenterLoads(startDate, endDate)

      expect(result).toHaveLength(1)
      expect(result[0].utilization_pct).toBe(75)
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('org_id', testOrgId)
      expect(mockSupabaseQuery.gte).toHaveBeenCalledWith('period_start', startDate)
      expect(mockSupabaseQuery.lte).toHaveBeenCalledWith('period_end', endDate)
    })
  })

  describe('identifyBottlenecks', () => {
    it('should identify bottlenecks', async () => {
      const startDate = '2024-01-01'
      const endDate = '2024-01-31'

      const mockBottlenecks: BottleneckAnalysis[] = [
        {
          work_center_id: testWorkCenterId,
          work_center_name: 'Work Center 1',
          available_hours: 160,
          planned_hours: 180,
          utilization_pct: 112.5,
          is_bottleneck: true,
          bottleneck_severity: 'HIGH',
        },
      ]

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: mockBottlenecks,
        error: null,
      } as any)

      const result = await capacityService.identifyBottlenecks(startDate, endDate)

      expect(result).toHaveLength(1)
      expect(result[0].is_bottleneck).toBe(true)
      expect(result[0].bottleneck_severity).toBe('HIGH')
      expect(supabase.rpc).toHaveBeenCalledWith('identify_bottlenecks', {
        p_org_id: testOrgId,
        p_start_date: startDate,
        p_end_date: endDate,
      })
    })
  })

  describe('getProductionSchedules', () => {
    it('should return production schedules with filters', async () => {
      const mockSchedules: Partial<ProductionSchedule>[] = [
        {
          id: testScheduleId,
          org_id: testOrgId,
          schedule_number: 'SCH-001',
          schedule_name: 'January Schedule',
          period_start: '2024-01-01',
          period_end: '2024-01-31',
          status: 'DRAFT',
          total_work_orders: 15,
          total_planned_hours: 120,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      mockSupabaseQuery.order.mockResolvedValue({
        data: mockSchedules,
        error: null,
      })

      const result = await capacityService.getProductionSchedules({
        status: 'DRAFT',
        fromDate: '2024-01-01',
        toDate: '2024-01-31',
      })

      expect(result).toHaveLength(1)
      expect(result[0].schedule_number).toBe('SCH-001')
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('org_id', testOrgId)
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('status', 'DRAFT')
    })
  })

  describe('createProductionSchedule', () => {
    it('should create production schedule', async () => {
      const scheduleData = {
        schedule_name: 'January Schedule',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        notes: 'Test schedule',
      }

      const mockSchedule: Partial<ProductionSchedule> = {
        id: testScheduleId,
        org_id: testOrgId,
        schedule_number: 'SCH-001',
        ...scheduleData,
        status: 'DRAFT',
        total_work_orders: 0,
        total_planned_hours: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockSchedule,
        error: null,
      })

      const result = await capacityService.createProductionSchedule(scheduleData)

      expect(result.schedule_name).toBe('January Schedule')
      expect(result.status).toBe('DRAFT')
      expect(result.total_work_orders).toBe(0)
      expect(mockSupabaseQuery.insert).toHaveBeenCalled()
    })
  })

  describe('getScheduleDetails', () => {
    it('should return schedule details', async () => {
      const mockDetails: Partial<ScheduleDetail>[] = [
        {
          id: 'detail-123',
          org_id: testOrgId,
          schedule_id: testScheduleId,
          work_order_id: testWorkOrderId,
          schedule_sequence: 1,
          scheduled_start: '2024-01-01T08:00:00Z',
          scheduled_end: '2024-01-01T16:00:00Z',
          priority: 1,
          schedule_status: 'SCHEDULED',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      mockSupabaseQuery.order.mockResolvedValue({
        data: mockDetails,
        error: null,
      })

      const result = await capacityService.getScheduleDetails(testScheduleId)

      expect(result).toHaveLength(1)
      expect(result[0].schedule_sequence).toBe(1)
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('schedule_id', testScheduleId)
    })
  })

  describe('scheduleWorkOrder', () => {
    it('should schedule work order', async () => {
      const scheduledStart = '2024-01-01T08:00:00Z'

      const mockDetail: Partial<ScheduleDetail> = {
        id: 'detail-123',
        org_id: testOrgId,
        schedule_id: testScheduleId,
        work_order_id: testWorkOrderId,
        schedule_sequence: 1,
        scheduled_start: scheduledStart,
        scheduled_end: '2024-01-01T16:00:00Z',
        priority: 1,
        schedule_status: 'SCHEDULED',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      vi.mocked(supabase.rpc).mockResolvedValue({
        data: mockDetail,
        error: null,
      } as any)

      const result = await capacityService.scheduleWorkOrder(
        testWorkOrderId,
        scheduledStart,
        testScheduleId
      )

      expect(result).not.toBeNull()
      expect(result?.scheduled_start).toBe(scheduledStart)
      expect(supabase.rpc).toHaveBeenCalledWith('schedule_work_order', {
        p_work_order_id: testWorkOrderId,
        p_scheduled_start: scheduledStart,
        p_schedule_id: testScheduleId,
      })
    })
  })

  describe('updateScheduleDetailStatus', () => {
    it('should update schedule detail status', async () => {
      const status = 'DELAYED'
      const delayReason = 'Material shortage'
      const delayHours = 4

      const mockDetail: Partial<ScheduleDetail> = {
        id: 'detail-123',
        org_id: testOrgId,
        schedule_id: testScheduleId,
        work_order_id: testWorkOrderId,
        schedule_sequence: 1,
        scheduled_start: '2024-01-01T08:00:00Z',
        scheduled_end: '2024-01-01T16:00:00Z',
        priority: 1,
        schedule_status: status,
        delay_reason: delayReason,
        delay_hours: delayHours,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      }

      mockSupabaseQuery.single.mockResolvedValue({
        data: mockDetail,
        error: null,
      })

      const result = await capacityService.updateScheduleDetailStatus(
        'detail-123',
        status,
        delayReason,
        delayHours
      )

      expect(result.schedule_status).toBe(status)
      expect(result.delay_reason).toBe(delayReason)
      expect(result.delay_hours).toBe(delayHours)
      expect(mockSupabaseQuery.update).toHaveBeenCalled()
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', 'detail-123')
    })
  })

  describe('rescheduleWorkOrder', () => {
    it('should reschedule work order', async () => {
      const newScheduledStart = '2024-01-02T08:00:00Z'
      const oldScheduledStart = '2024-01-01T08:00:00Z'
      const oldScheduledEnd = '2024-01-01T16:00:00Z'

      // Mock getting existing detail
      mockSupabaseQuery.single
        .mockResolvedValueOnce({
          data: {
            scheduled_start: oldScheduledStart,
            scheduled_end: oldScheduledEnd,
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: 'detail-123',
            scheduled_start: newScheduledStart,
            scheduled_end: '2024-01-02T16:00:00Z',
          },
          error: null,
        })

      const result = await capacityService.rescheduleWorkOrder('detail-123', newScheduledStart)

      expect(result.scheduled_start).toBe(newScheduledStart)
      expect(mockSupabaseQuery.update).toHaveBeenCalled()
    })
  })

  describe('getWeeklyScheduleSummary', () => {
    it('should return weekly schedule summary', async () => {
      const mockDetails = [
        { schedule_status: 'COMPLETED' },
        { schedule_status: 'STARTED' },
        { schedule_status: 'DELAYED' },
        { schedule_status: 'SCHEDULED' },
      ]

      const mockLoads = [{ utilization_pct: 75 }, { utilization_pct: 85 }]

      mockSupabaseQuery.eq
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockResolvedValue({ data: mockDetails, error: null }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockResolvedValue({ data: mockLoads, error: null }),
        })

      const result = await capacityService.getWeeklyScheduleSummary()

      expect(result.total_scheduled).toBe(4)
      expect(result.completed).toBe(1)
      expect(result.in_progress).toBe(1)
      expect(result.delayed).toBe(1)
      expect(result.utilization_avg).toBe(80) // (75 + 85) / 2 = 80
    })
  })
})

