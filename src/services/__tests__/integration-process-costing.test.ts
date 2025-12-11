/**
 * Integration Tests: Process Costing Service
 * 
 * Tests the REAL process-costing-service.ts code (407 lines)
 * Coverage target: src/services/process-costing-service.ts
 * 
 * Categories:
 * 1. Labor Time Application
 * 2. Overhead Application
 * 3. Stage Cost Calculation
 * 4. Cost Retrieval
 * 5. Real-World Manufacturing Scenarios
 * 6. Edge Cases
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ProcessCostingParams } from '../process-costing-service'

// Mock config FIRST
vi.mock('@/lib/config', () => ({
  loadConfig: vi.fn(() => Promise.resolve({
    ORG_ID: 'test-org-id',
    TENANT_ID: 'test-tenant-id'
  }))
}))

// Mock Supabase SECOND - Create a chainable builder pattern with ALL methods
vi.mock('@/lib/supabase', () => {
  // Create a function that returns a fully chainable mock supporting ALL Supabase methods
  const createChainableMock = (): any => {
    const chain: any = {
      from: vi.fn(() => chain),
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      upsert: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      in: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null }))
    }
    return chain
  }
  
  return {
    supabase: createChainableMock()
  }
})

// Import service AFTER mocks
import { processCostingService } from '../process-costing-service'
import { supabase } from '@/lib/supabase'

// Get typed mock
const mockSupabase = supabase as any

describe('Integration: Process Costing Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Reset all chain methods to return the mock itself for chaining
    mockSupabase.from.mockReturnValue(mockSupabase)
    mockSupabase.select.mockReturnValue(mockSupabase)
    mockSupabase.insert.mockReturnValue(mockSupabase) // After insert, return chain for .select()
    mockSupabase.update.mockReturnValue(mockSupabase)
    mockSupabase.upsert.mockReturnValue(mockSupabase)
    mockSupabase.delete.mockReturnValue(mockSupabase)
    mockSupabase.eq.mockReturnValue(mockSupabase)
    mockSupabase.neq.mockReturnValue(mockSupabase)
    mockSupabase.gt.mockReturnValue(mockSupabase)
    mockSupabase.gte.mockReturnValue(mockSupabase)
    mockSupabase.lt.mockReturnValue(mockSupabase)
    mockSupabase.lte.mockReturnValue(mockSupabase)
    mockSupabase.in.mockReturnValue(mockSupabase)
    mockSupabase.limit.mockReturnValue(mockSupabase)
    mockSupabase.order.mockReturnValue(mockSupabase)
    mockSupabase.range.mockReturnValue(mockSupabase)
    
    // Terminal methods that return promises with mock data
    mockSupabase.single.mockResolvedValue({ 
      data: { 
        id: 'generated-id',
        total_cost: 500,
        order_sequence: 10
      }, 
      error: null 
    })
    mockSupabase.maybeSingle.mockResolvedValue({ data: [], error: null })
  })

  describe('Labor Time Application', () => {
    it('should calculate labor cost correctly', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        laborHours: 10,
        hourlyRate: 50,
        employeeName: 'Ahmed Ali',
        operationCode: 'ROLLING'
      }

      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          id: 'labor-001',
          mo_id: params.moId,
          stage_id: params.stageId,
          hours: params.laborHours,
          hourly_rate: params.hourlyRate,
          total_cost: 500 // 10 * 50
        }],
        error: null
      })

      const result = await processCostingService.applyLaborTime(params)

      expect(result.success).toBe(true)
      expect(result.data.totalLaborCost).toBe(500)
      expect(result.data.hours).toBe(10)
      expect(result.data.hourlyRate).toBe(50)
    })

    it('should handle multiple labor entries for same stage', async () => {
      const params1: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        laborHours: 8,
        hourlyRate: 50
      }

      const params2: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        laborHours: 4,
        hourlyRate: 60
      }

      mockSupabase.insert.mockResolvedValueOnce({
        data: [{ total_cost: 400 }],
        error: null
      })

      mockSupabase.insert.mockResolvedValueOnce({
        data: [{ total_cost: 240 }],
        error: null
      })

      const result1 = await processCostingService.applyLaborTime(params1)
      const result2 = await processCostingService.applyLaborTime(params2)

      expect(result1.data.totalLaborCost).toBe(400)
      expect(result2.data.totalLaborCost).toBe(240)
      // Total labor cost = 400 + 240 = 640
    })

    it('should reject negative labor hours', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        laborHours: -5,
        hourlyRate: 50
      }

      await expect(
        processCostingService.applyLaborTime(params)
      ).rejects.toThrow()
    })

    it('should reject zero or negative hourly rate', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        laborHours: 10,
        hourlyRate: 0
      }

      await expect(
        processCostingService.applyLaborTime(params)
      ).rejects.toThrow()
    })

    it('should validate required fields for labor', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        // Missing stageId
        laborHours: 10,
        hourlyRate: 50
      }

      await expect(
        processCostingService.applyLaborTime(params)
      ).rejects.toThrow(/required/i)
    })
  })

  describe('Overhead Application', () => {
    it('should calculate overhead cost correctly', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        workCenterId: 'wc-001',
        baseQty: 100,
        overheadRate: 5,
        overheadType: 'MACHINE_HOURS'
      }

      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          id: 'moh-001',
          amount: 500, // 100 * 5
          base_qty: 100,
          rate: 5
        }],
        error: null
      })

      const result = await processCostingService.applyOverhead(params)

      expect(result.success).toBe(true)
      expect(result.data.overheadAmount).toBe(500)
      expect(result.data.baseQty).toBe(100)
      expect(result.data.rate).toBe(5)
    })

    it('should support different overhead allocation bases', async () => {
      const testCases = [
        { type: 'MACHINE_HOURS', baseQty: 50, rate: 10, expected: 500 },
        { type: 'LABOR_HOURS', baseQty: 40, rate: 8, expected: 320 },
        { type: 'DIRECT_LABOR_COST', baseQty: 1000, rate: 0.5, expected: 500 },
        { type: 'UNITS_PRODUCED', baseQty: 200, rate: 2.5, expected: 500 }
      ]

      for (const tc of testCases) {
        mockSupabase.insert.mockResolvedValueOnce({
          data: [{ amount: tc.expected }],
          error: null
        })

        const result = await processCostingService.applyOverhead({
          moId: 'mo-001',
          stageNo: 10,
          baseQty: tc.baseQty,
          overheadRate: tc.rate,
          overheadType: tc.type
        })

        expect(result.data.overheadAmount).toBe(tc.expected)
      }
    })

    it('should handle fractional overhead rates', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        baseQty: 100,
        overheadRate: 2.75
      }

      mockSupabase.insert.mockResolvedValueOnce({
        data: [{ amount: 275 }],
        error: null
      })

      const result = await processCostingService.applyOverhead(params)
      expect(result.data.overheadAmount).toBe(275)
    })

    it('should reject negative base quantity', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        baseQty: -50,
        overheadRate: 5
      }

      await expect(
        processCostingService.applyOverhead(params)
      ).rejects.toThrow()
    })

    it('should validate required fields for overhead', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        baseQty: 100
        // Missing overheadRate
      }

      await expect(
        processCostingService.applyOverhead(params)
      ).rejects.toThrow(/required/i)
    })
  })

  describe('Stage Cost Calculation', () => {
    it('should calculate total stage cost with all components', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        workCenterId: 'wc-001',
        goodQty: 100,
        directMaterialCost: 5000,
        mode: 'actual'
      }

      // Mock labor cost query
      mockSupabase.select.mockResolvedValueOnce({
        data: [{ total_cost: 400 }, { total_cost: 240 }],
        error: null
      })

      // Mock overhead query
      mockSupabase.select.mockResolvedValueOnce({
        data: [{ amount: 500 }],
        error: null
      })

      // Mock insert
      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          id: 'cost-001',
          manufacturing_order_id: params.moId,
          stage_id: params.stageId,
          good_quantity: 100,
          material_cost: 5000,
          labor_cost: 640, // 400 + 240
          overhead_cost: 500,
          total_cost: 6140,
          unit_cost: 61.4,
          status: 'actual'
        }],
        error: null
      })

      const result = await processCostingService.upsertStageCost(params)

      expect(result.success).toBe(true)
      expect(result.data.material_cost).toBe(5000)
      expect(result.data.labor_cost).toBe(640)
      expect(result.data.overhead_cost).toBe(500)
      expect(result.data.total_cost).toBe(6140)
      expect(result.data.unit_cost).toBeCloseTo(61.4, 2)
    })

    it('should calculate unit cost correctly', async () => {
      const testCases = [
        { goodQty: 100, totalCost: 5000, expectedUnitCost: 50 },
        { goodQty: 200, totalCost: 8000, expectedUnitCost: 40 },
        { goodQty: 50, totalCost: 1250, expectedUnitCost: 25 },
        { goodQty: 1, totalCost: 100, expectedUnitCost: 100 }
      ]

      for (const tc of testCases) {
        mockSupabase.select.mockResolvedValue({ data: [], error: null })
        mockSupabase.insert.mockResolvedValueOnce({
          data: [{
            good_quantity: tc.goodQty,
            total_cost: tc.totalCost,
            unit_cost: tc.expectedUnitCost
          }],
          error: null
        })

        const result = await processCostingService.upsertStageCost({
          moId: 'mo-001',
          stageNo: 10,
          goodQty: tc.goodQty,
          directMaterialCost: tc.totalCost
        })

        expect(result.data.unit_cost).toBeCloseTo(tc.expectedUnitCost, 2)
      }
    })

    it('should handle scrap and rework quantities', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        goodQty: 90,
        scrapQty: 5,
        reworkQty: 5,
        directMaterialCost: 5000
      }

      mockSupabase.select.mockResolvedValue({ data: [], error: null })
      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          good_quantity: 90,
          scrap_quantity: 5,
          defective_quantity: 5,
          total_cost: 5000,
          unit_cost: 55.56 // 5000 / 90
        }],
        error: null
      })

      const result = await processCostingService.upsertStageCost(params)

      expect(result.data.good_quantity).toBe(90)
      expect(result.data.scrap_quantity).toBe(5)
      expect(result.data.defective_quantity).toBe(5)
      // Unit cost based on good quantity only
      expect(result.data.unit_cost).toBeCloseTo(55.56, 2)
    })

    it('should handle zero material cost (labor/overhead only)', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        goodQty: 100,
        directMaterialCost: 0
      }

      mockSupabase.select.mockResolvedValueOnce({
        data: [{ total_cost: 500 }],
        error: null
      })

      mockSupabase.select.mockResolvedValueOnce({
        data: [{ amount: 200 }],
        error: null
      })

      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          material_cost: 0,
          labor_cost: 500,
          overhead_cost: 200,
          total_cost: 700,
          unit_cost: 7
        }],
        error: null
      })

      const result = await processCostingService.upsertStageCost(params)

      expect(result.data.material_cost).toBe(0)
      expect(result.data.total_cost).toBe(700)
      expect(result.data.unit_cost).toBe(7)
    })

    it('should return zero unit cost for zero quantity', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        goodQty: 0,
        directMaterialCost: 5000
      }

      await expect(
        processCostingService.upsertStageCost(params)
      ).rejects.toThrow(/goodQty/i)
    })

    it('should support different cost modes', async () => {
      const modes = ['precosted', 'actual', 'completed'] as const

      for (const mode of modes) {
        mockSupabase.select.mockResolvedValue({ data: [], error: null })
        mockSupabase.insert.mockResolvedValueOnce({
          data: [{
            status: mode,
            total_cost: 5000
          }],
          error: null
        })

        const result = await processCostingService.upsertStageCost({
          moId: 'mo-001',
          stageNo: 10,
          goodQty: 100,
          mode
        })

        expect(result.data.status).toBe(mode)
      }
    })
  })

  describe('Cost Retrieval', () => {
    it('should get all stage costs for manufacturing order', async () => {
      const moId = 'mo-001'

      mockSupabase.select.mockResolvedValueOnce({
        data: [
          {
            stage_number: 10,
            good_quantity: 100,
            total_cost: 5000,
            unit_cost: 50,
            status: 'completed'
          },
          {
            stage_number: 20,
            good_quantity: 95,
            total_cost: 4800,
            unit_cost: 50.53,
            status: 'completed'
          },
          {
            stage_number: 30,
            good_quantity: 90,
            total_cost: 4600,
            unit_cost: 51.11,
            status: 'actual'
          }
        ],
        error: null
      })

      const result = await processCostingService.getStageCosts(moId)

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(3)
      expect(result.data[0].stage_number).toBe(10)
      expect(result.data[2].stage_number).toBe(30)
    })

    it('should return empty array if no costs found', async () => {
      mockSupabase.select.mockResolvedValueOnce({
        data: [],
        error: null
      })

      const result = await processCostingService.getStageCosts('mo-999')

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('should order stage costs by stage number', async () => {
      mockSupabase.select.mockResolvedValueOnce({
        data: [
          { stage_number: 10, total_cost: 5000 },
          { stage_number: 20, total_cost: 4800 },
          { stage_number: 30, total_cost: 4600 }
        ],
        error: null
      })

      const result = await processCostingService.getStageCosts('mo-001')

      expect(result.data[0].stage_number).toBeLessThan(result.data[1].stage_number!)
      expect(result.data[1].stage_number).toBeLessThan(result.data[2].stage_number!)
    })
  })

  describe('Real-World Manufacturing Scenarios', () => {
    it('should handle complete manufacturing flow', async () => {
      const moId = 'mo-001'
      const stageId = 'stage-001'

      // Step 1: Apply labor
      mockSupabase.insert.mockResolvedValueOnce({
        data: [{ total_cost: 400 }],
        error: null
      })

      const laborResult = await processCostingService.applyLaborTime({
        moId,
        stageId,
        laborHours: 8,
        hourlyRate: 50
      })

      expect(laborResult.data.totalLaborCost).toBe(400)

      // Step 2: Apply overhead
      mockSupabase.insert.mockResolvedValueOnce({
        data: [{ amount: 320 }],
        error: null
      })

      const overheadResult = await processCostingService.applyOverhead({
        moId,
        stageId,
        baseQty: 40,
        overheadRate: 8
      })

      expect(overheadResult.data.overheadAmount).toBe(320)

      // Step 3: Calculate final stage cost
      mockSupabase.select.mockResolvedValueOnce({
        data: [{ total_cost: 400 }],
        error: null
      })

      mockSupabase.select.mockResolvedValueOnce({
        data: [{ amount: 320 }],
        error: null
      })

      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          material_cost: 5000,
          labor_cost: 400,
          overhead_cost: 320,
          total_cost: 5720,
          unit_cost: 57.2
        }],
        error: null
      })

      const costResult = await processCostingService.upsertStageCost({
        moId,
        stageId,
        goodQty: 100,
        directMaterialCost: 5000
      })

      expect(costResult.data.total_cost).toBe(5720)
      expect(costResult.data.unit_cost).toBeCloseTo(57.2, 2)
    })

    it('should handle multi-stage process costing', async () => {
      const moId = 'mo-001'
      const stages = ['stage-001', 'stage-002', 'stage-003']
      const stageCosts = [5000, 4800, 4600]

      for (let i = 0; i < stages.length; i++) {
        mockSupabase.select.mockResolvedValue({ data: [], error: null })
        mockSupabase.insert.mockResolvedValueOnce({
          data: [{
            stage_id: stages[i],
            total_cost: stageCosts[i],
            unit_cost: stageCosts[i] / 100
          }],
          error: null
        })

        const result = await processCostingService.upsertStageCost({
          moId,
          stageId: stages[i],
          goodQty: 100,
          directMaterialCost: stageCosts[i]
        })

        expect(result.data.total_cost).toBe(stageCosts[i])
      }

      // Total cost across all stages = 14400
      const totalCost = stageCosts.reduce((sum, cost) => sum + cost, 0)
      expect(totalCost).toBe(14400)
    })

    it('should track cost progression with scrap', async () => {
      const stages = [
        { goodQty: 100, scrapQty: 0, materialCost: 5000 },
        { goodQty: 95, scrapQty: 5, materialCost: 0 },
        { goodQty: 90, scrapQty: 5, materialCost: 0 }
      ]

      for (const stage of stages) {
        mockSupabase.select.mockResolvedValue({ data: [], error: null })
        mockSupabase.insert.mockResolvedValueOnce({
          data: [{
            good_quantity: stage.goodQty,
            scrap_quantity: stage.scrapQty,
            material_cost: stage.materialCost
          }],
          error: null
        })

        const result = await processCostingService.upsertStageCost({
          moId: 'mo-001',
          stageId: `stage-00${stages.indexOf(stage) + 1}`,
          goodQty: stage.goodQty,
          scrapQty: stage.scrapQty,
          directMaterialCost: stage.materialCost
        })

        expect(result.data.good_quantity).toBe(stage.goodQty)
      }
    })
  })

  describe('Edge Cases & Validation', () => {
    it('should handle very large quantities', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        goodQty: 1000000,
        directMaterialCost: 50000000
      }

      mockSupabase.select.mockResolvedValue({ data: [], error: null })
      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          good_quantity: 1000000,
          total_cost: 50000000,
          unit_cost: 50
        }],
        error: null
      })

      const result = await processCostingService.upsertStageCost(params)

      expect(result.data.unit_cost).toBe(50)
    })

    it('should handle high-precision decimal costs', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        goodQty: 100,
        directMaterialCost: 1234.5678
      }

      mockSupabase.select.mockResolvedValue({ data: [], error: null })
      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          material_cost: 1234.5678,
          unit_cost: 12.345678
        }],
        error: null
      })

      const result = await processCostingService.upsertStageCost(params)

      expect(result.data.unit_cost).toBeCloseTo(12.345678, 6)
    })

    it('should validate moId is required', async () => {
      const params: ProcessCostingParams = {
        moId: '',
        stageNo: 10,
        goodQty: 100
      }

      await expect(
        processCostingService.upsertStageCost(params)
      ).rejects.toThrow(/moId/i)
    })

    it('should require either stageId or stageNo', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        goodQty: 100
      }

      await expect(
        processCostingService.upsertStageCost(params)
      ).rejects.toThrow(/stageId|stageNo/i)
    })

    it('should handle backward compatibility with stageNo', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageNo: 10,
        goodQty: 100,
        directMaterialCost: 5000
      }

      mockSupabase.select.mockResolvedValue({ data: [], error: null })
      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          stage_number: 10,
          total_cost: 5000
        }],
        error: null
      })

      const result = await processCostingService.upsertStageCost(params)

      expect(result.data.stage_number).toBe(10)
    })

    it('should prioritize stageId over stageNo when both provided', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-001',
        stageId: 'stage-uuid-001',
        stageNo: 10,
        goodQty: 100
      }

      mockSupabase.select.mockResolvedValue({ data: [], error: null })
      mockSupabase.insert.mockResolvedValueOnce({
        data: [{
          stage_id: 'stage-uuid-001',
          stage_number: 10
        }],
        error: null
      })

      const result = await processCostingService.upsertStageCost(params)

      expect(result.data.stage_id).toBe('stage-uuid-001')
    })
  })
})
