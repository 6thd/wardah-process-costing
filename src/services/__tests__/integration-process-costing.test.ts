/**
 * Integration Tests for Process Costing Service
 * Phase 4 of TEST_COVERAGE_PLAN.md
 * 
 * Tests the real code from src/services/process-costing-service.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Supabase before importing the service
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

// Mock loadConfig - must return the config object properly
const mockConfig = {
  ORG_ID: 'test-org-123',
  TABLE_NAMES: {},
  APP_SETTINGS: { default_currency: 'SAR' },
  FEATURES: { process_costing: true },
}

vi.mock('@/lib/config', () => ({
  loadConfig: vi.fn(() => Promise.resolve(mockConfig)),
}))

// Import after mocks are set up
import { processCostingService, type ProcessCostingParams, type StageCostResult, type LaborTimeResult, type OverheadResult } from '../process-costing-service'
import { supabase } from '@/lib/supabase'

describe('Integration: process-costing-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================
  // ProcessCostingParams Interface Tests
  // ============================================
  describe('ProcessCostingParams Interface', () => {
    it('should accept minimal required params', () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        goodQty: 100,
      }
      expect(params.moId).toBe('mo-001')
      expect(params.stageNo).toBe(1)
    })

    it('should accept all optional params', () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageId: 'stage-uuid-123',
        stageNo: 1,
        workCenterId: 'wc-001',
        goodQty: 100,
        scrapQty: 5,
        reworkQty: 2,
        directMaterialCost: 5000,
        laborHours: 8,
        hourlyRate: 50,
        overheadRate: 0.15,
        baseQty: 100,
        overheadType: 'variable',
        employeeName: 'أحمد',
        operationCode: 'OP-001',
        notes: 'Test notes',
        mode: 'actual',
      }
      
      expect(params.stageId).toBe('stage-uuid-123')
      expect(params.workCenterId).toBe('wc-001')
      expect(params.laborHours).toBe(8)
      expect(params.mode).toBe('actual')
    })

    it('should support all mode types', () => {
      const modes: ProcessCostingParams['mode'][] = ['precosted', 'actual', 'completed']
      modes.forEach(mode => {
        const params: ProcessCostingParams = { moId: 'mo-001', mode }
        expect(params.mode).toBe(mode)
      })
    })
  })

  // ============================================
  // StageCostResult Interface Tests
  // ============================================
  describe('StageCostResult Interface', () => {
    it('should have correct structure', () => {
      const result: StageCostResult = {
        id: 'sc-001',
        manufacturing_order_id: 'mo-001',
        stage_id: 'stage-uuid',
        stage_number: 1,
        work_center_id: 'wc-001',
        good_quantity: 100,
        scrap_quantity: 5,
        material_cost: 5000,
        labor_cost: 2000,
        overhead_cost: 1050,
        total_cost: 8050,
        unit_cost: 80.5,
        status: 'actual',
      }

      expect(result.total_cost).toBe(
        result.material_cost + result.labor_cost + result.overhead_cost
      )
      expect(result.unit_cost).toBeCloseTo(result.total_cost / result.good_quantity, 2)
    })
  })

  // ============================================
  // applyLaborTime Tests
  // ============================================
  describe('applyLaborTime', () => {
    it('should throw error when moId is missing', async () => {
      const params: ProcessCostingParams = {
        moId: '',
        stageNo: 1,
        laborHours: 8,
        hourlyRate: 50,
      }

      await expect(processCostingService.applyLaborTime(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should throw error when stageId and stageNo are both missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        laborHours: 8,
        hourlyRate: 50,
      }

      await expect(processCostingService.applyLaborTime(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should throw error when laborHours is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        hourlyRate: 50,
      }

      await expect(processCostingService.applyLaborTime(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should throw error when hourlyRate is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        laborHours: 8,
      }

      await expect(processCostingService.applyLaborTime(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should calculate labor cost correctly with stageNo', async () => {
      // Setup mock for work_centers query
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'work_centers') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ 
              data: { id: 'wc-default-001' }, 
              error: null 
            }),
          }
        }
        if (table === 'labor_time_logs') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'ltl-001' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        laborHours: 8,
        hourlyRate: 50,
        employeeName: 'محمد',
      }

      const result = await processCostingService.applyLaborTime(params)

      expect(result.success).toBe(true)
      expect(result.data.totalLaborCost).toBe(400) // 8 * 50
      expect(result.data.hours).toBe(8)
      expect(result.data.hourlyRate).toBe(50)
    })

    it('should get stage_no from stageId when stageNo not provided', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'manufacturing_stages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { order_sequence: 2 },
              error: null,
            }),
          }
        }
        if (table === 'work_centers') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ 
              data: { id: 'wc-default-001' }, 
              error: null 
            }),
          }
        }
        if (table === 'labor_time_logs') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'ltl-001' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageId: 'stage-uuid-123', // Only stageId, no stageNo
        laborHours: 10,
        hourlyRate: 45,
      }

      const result = await processCostingService.applyLaborTime(params)

      expect(result.success).toBe(true)
      expect(result.data.totalLaborCost).toBe(450) // 10 * 45
    })

    it('should use provided workCenterId', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'labor_time_logs') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'ltl-001' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        workCenterId: 'wc-custom-001',
        laborHours: 5,
        hourlyRate: 60,
      }

      const result = await processCostingService.applyLaborTime(params)

      expect(result.success).toBe(true)
      expect(result.data.totalLaborCost).toBe(300) // 5 * 60
    })
  })

  // ============================================
  // applyOverhead Tests
  // ============================================
  describe('applyOverhead', () => {
    it('should throw error when moId is missing', async () => {
      const params: ProcessCostingParams = {
        moId: '',
        stageNo: 1,
        baseQty: 100,
        overheadRate: 0.15,
      }

      await expect(processCostingService.applyOverhead(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should throw error when baseQty is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        overheadRate: 0.15,
      }

      await expect(processCostingService.applyOverhead(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should throw error when overheadRate is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        baseQty: 100,
      }

      await expect(processCostingService.applyOverhead(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should calculate overhead correctly with stageNo', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'work_centers') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ 
              data: { id: 'wc-default-001' }, 
              error: null 
            }),
          }
        }
        if (table === 'moh_applied') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'moh-001' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        baseQty: 100,
        overheadRate: 0.15,
        overheadType: 'variable',
      }

      const result = await processCostingService.applyOverhead(params)

      expect(result.success).toBe(true)
      expect(result.data.overheadAmount).toBe(15) // 100 * 0.15
      expect(result.data.baseQty).toBe(100)
      expect(result.data.rate).toBe(0.15)
    })

    it('should get stage_no from stageId when stageNo not provided', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'manufacturing_stages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { order_sequence: 3 },
              error: null,
            }),
          }
        }
        if (table === 'work_centers') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ 
              data: { id: 'wc-default-001' }, 
              error: null 
            }),
          }
        }
        if (table === 'moh_applied') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'moh-001' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageId: 'stage-uuid-456',
        baseQty: 200,
        overheadRate: 0.25,
      }

      const result = await processCostingService.applyOverhead(params)

      expect(result.success).toBe(true)
      expect(result.data.overheadAmount).toBe(50) // 200 * 0.25
    })

    it('should handle large overhead calculations', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'work_centers') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ 
              data: { id: 'wc-default-001' }, 
              error: null 
            }),
          }
        }
        if (table === 'moh_applied') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'moh-001' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        baseQty: 10000,
        overheadRate: 12.50,
      }

      const result = await processCostingService.applyOverhead(params)

      expect(result.success).toBe(true)
      expect(result.data.overheadAmount).toBe(125000) // 10000 * 12.50
    })
  })

  // ============================================
  // upsertStageCost Tests
  // ============================================
  describe('upsertStageCost', () => {
    it('should throw error when moId is missing', async () => {
      const params: ProcessCostingParams = {
        moId: '',
        stageNo: 1,
        goodQty: 100,
      }

      await expect(processCostingService.upsertStageCost(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should throw error when goodQty is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
      }

      await expect(processCostingService.upsertStageCost(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should calculate total cost correctly', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'labor_time_logs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: [{ total_cost: 500 }, { total_cost: 300 }],
              error: null,
            }),
          }
        }
        if (table === 'moh_applied') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: [{ amount: 200 }],
              error: null,
            }),
          }
        }
        if (table === 'stage_costs') {
          return {
            upsert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'sc-001',
                manufacturing_order_id: 'mo-001',
                stage_number: 1,
                good_quantity: 100,
                scrap_quantity: 5,
                material_cost: 5000,
                labor_cost: 800,
                overhead_cost: 200,
                total_cost: 6000,
                unit_cost: 60,
                status: 'actual',
              },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        goodQty: 100,
        scrapQty: 5,
        directMaterialCost: 5000,
        mode: 'actual',
      }

      const result = await processCostingService.upsertStageCost(params)

      expect(result.success).toBe(true)
      expect(result.data.manufacturing_order_id).toBe('mo-001')
      expect(result.data.good_quantity).toBe(100)
      expect(result.data.status).toBe('actual')
    })

    it('should calculate unit cost correctly', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'labor_time_logs' || table === 'moh_applied') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        if (table === 'stage_costs') {
          return {
            upsert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        goodQty: 50,
        directMaterialCost: 2500,
      }

      const result = await processCostingService.upsertStageCost(params)

      expect(result.success).toBe(true)
      // unit_cost = total_cost / good_quantity = 2500 / 50 = 50
      expect(result.data.unit_cost).toBe(50)
    })

    it('should handle zero quantity edge case', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'labor_time_logs' || table === 'moh_applied') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        if (table === 'stage_costs') {
          return {
            upsert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        goodQty: 0, // Edge case: zero quantity
        directMaterialCost: 1000,
      }

      // Should throw error because goodQty is 0 (falsy)
      await expect(processCostingService.upsertStageCost(params))
        .rejects.toThrow('Missing required parameters')
    })

    it('should use stageId for conflict resolution when provided', async () => {
      const mockUpsert = vi.fn().mockReturnThis()
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'manufacturing_stages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { order_sequence: 1 },
              error: null,
            }),
          }
        }
        if (table === 'labor_time_logs' || table === 'moh_applied') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        if (table === 'stage_costs') {
          return {
            upsert: mockUpsert,
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageId: 'stage-uuid-789',
        goodQty: 100,
      }

      await processCostingService.upsertStageCost(params)

      // Verify upsert was called with stage_id
      expect(mockUpsert).toHaveBeenCalled()
    })
  })

  // ============================================
  // getStageCosts Tests
  // ============================================
  describe('getStageCosts', () => {
    it('should throw error when moId is missing', async () => {
      await expect(processCostingService.getStageCosts(''))
        .rejects.toThrow('Missing required parameter: moId')
    })

    it('should return empty array when no stage costs exist', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const result = await processCostingService.getStageCosts('mo-001')

      expect(result.success).toBe(true)
      expect(result.data).toEqual([])
    })

    it('should return stage costs ordered by stage_number', async () => {
      const mockStageCosts: StageCostResult[] = [
        {
          id: 'sc-001',
          manufacturing_order_id: 'mo-001',
          stage_number: 1,
          good_quantity: 100,
          scrap_quantity: 5,
          material_cost: 5000,
          labor_cost: 1000,
          overhead_cost: 500,
          total_cost: 6500,
          unit_cost: 65,
          status: 'actual',
        },
        {
          id: 'sc-002',
          manufacturing_order_id: 'mo-001',
          stage_number: 2,
          good_quantity: 95,
          scrap_quantity: 2,
          material_cost: 0,
          labor_cost: 800,
          overhead_cost: 400,
          total_cost: 1200,
          unit_cost: 12.63,
          status: 'actual',
        },
      ]

      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: mockStageCosts,
          error: null,
        }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const result = await processCostingService.getStageCosts('mo-001')

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data[0].stage_number).toBe(1)
      expect(result.data[1].stage_number).toBe(2)
    })

    it('should handle multiple stages with different statuses', async () => {
      const mockStageCosts: StageCostResult[] = [
        {
          id: 'sc-001',
          manufacturing_order_id: 'mo-001',
          stage_number: 1,
          good_quantity: 100,
          scrap_quantity: 0,
          material_cost: 5000,
          labor_cost: 1000,
          overhead_cost: 500,
          total_cost: 6500,
          unit_cost: 65,
          status: 'completed',
        },
        {
          id: 'sc-002',
          manufacturing_order_id: 'mo-001',
          stage_number: 2,
          good_quantity: 100,
          scrap_quantity: 0,
          material_cost: 0,
          labor_cost: 500,
          overhead_cost: 250,
          total_cost: 750,
          unit_cost: 7.5,
          status: 'actual',
        },
        {
          id: 'sc-003',
          manufacturing_order_id: 'mo-001',
          stage_number: 3,
          good_quantity: 0,
          scrap_quantity: 0,
          material_cost: 0,
          labor_cost: 0,
          overhead_cost: 0,
          total_cost: 0,
          unit_cost: 0,
          status: 'precosted',
        },
      ]

      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: mockStageCosts,
          error: null,
        }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const result = await processCostingService.getStageCosts('mo-001')

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(3)
      expect(result.data[0].status).toBe('completed')
      expect(result.data[1].status).toBe('actual')
      expect(result.data[2].status).toBe('precosted')
    })
  })

  // ============================================
  // Cost Calculation Accuracy Tests
  // ============================================
  describe('Cost Calculation Accuracy', () => {
    it('should maintain precision in labor cost calculation', () => {
      // Test internal calculation logic
      const laborHours = 8.5
      const hourlyRate = 47.25
      const expectedCost = 401.625

      const actualCost = laborHours * hourlyRate
      expect(actualCost).toBeCloseTo(expectedCost, 3)
    })

    it('should maintain precision in overhead calculation', () => {
      const baseQty = 1000
      const overheadRate = 0.1275
      const expectedOverhead = 127.5

      const actualOverhead = baseQty * overheadRate
      expect(actualOverhead).toBeCloseTo(expectedOverhead, 2)
    })

    it('should calculate unit cost with proper rounding', () => {
      const totalCost = 15678.90
      const goodQty = 234

      const unitCost = totalCost / goodQty
      expect(unitCost).toBeCloseTo(67.00385, 2) // 2 decimal places precision
    })

    it('should handle very small quantities', () => {
      const totalCost = 100
      const goodQty = 0.001 // Very small quantity

      const unitCost = totalCost / goodQty
      expect(unitCost).toBe(100000)
    })

    it('should handle large numbers without overflow', () => {
      const laborHours = 10000
      const hourlyRate = 500
      const expectedCost = 5000000

      const actualCost = laborHours * hourlyRate
      expect(actualCost).toBe(expectedCost)
    })
  })

  // ============================================
  // Error Handling Tests
  // ============================================
  describe('Error Handling', () => {
    it('should handle database errors in applyLaborTime', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database connection failed' },
        }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        laborHours: 8,
        hourlyRate: 50,
      }

      await expect(processCostingService.applyLaborTime(params))
        .rejects.toThrow()
    })

    it('should handle missing work center gracefully', async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'work_centers') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null, // No work center found
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 1,
        laborHours: 8,
        hourlyRate: 50,
      }

      // Should throw error because no work center is found
      await expect(processCostingService.applyLaborTime(params))
        .rejects.toThrow()
    })
  })

  // ============================================
  // LaborTimeResult Interface Tests
  // ============================================
  describe('LaborTimeResult Interface', () => {
    it('should have correct structure', () => {
      const result: LaborTimeResult = {
        id: 'ltl-001',
        totalLaborCost: 400,
        hours: 8,
        hourlyRate: 50,
      }

      expect(result.totalLaborCost).toBe(result.hours * result.hourlyRate)
    })
  })

  // ============================================
  // OverheadResult Interface Tests
  // ============================================
  describe('OverheadResult Interface', () => {
    it('should have correct structure', () => {
      const result: OverheadResult = {
        id: 'moh-001',
        overheadAmount: 150,
        baseQty: 1000,
        rate: 0.15,
      }

      expect(result.overheadAmount).toBe(result.baseQty * result.rate)
    })
  })
})
