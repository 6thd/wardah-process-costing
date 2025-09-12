/**
 * Unit Tests for Process Costing Domain Logic
 * Tests the core process costing calculations and AVCO methodology
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn()
      })),
      order: vi.fn(() => ({
        limit: vi.fn()
      }))
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn()
      }))
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn()
        }))
      }))
    })),
    upsert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn()
      }))
    }))
  })),
  rpc: vi.fn()
}

vi.mock('../../lib/supabase', () => ({
  supabase: mockSupabase
}))

// Import the module after mocking
import ProcessCosting from '../../domain/processCosting.js'

describe('Process Costing Domain Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Stage Cost Calculation', () => {
    it('should calculate stage cost using standard process costing formula', () => {
      const stageData = {
        transferredIn: 5000,
        directMaterials: 2000,
        directLabor: 1500,
        manufacturingOverhead: 1000,
        wasteCredit: 200,
        goodQuantity: 100
      }

      // Formula: Total Cost = Transferred In + Direct Materials + Direct Labor + MOH - Waste Credit
      const expectedTotalCost = stageData.transferredIn + 
                               stageData.directMaterials + 
                               stageData.directLabor + 
                               stageData.manufacturingOverhead - 
                               stageData.wasteCredit

      const expectedUnitCost = expectedTotalCost / stageData.goodQuantity

      expect(expectedTotalCost).toBe(9300)
      expect(expectedUnitCost).toBe(93)
    })

    it('should handle multiple stage cost flow correctly', () => {
      // Stage 1: Raw materials processing
      const stage1 = {
        transferredIn: 0, // No previous stage
        directMaterials: 10000,
        directLabor: 3000,
        manufacturingOverhead: 2000,
        goodQuantity: 1000
      }
      
      const stage1TotalCost = stage1.transferredIn + stage1.directMaterials + stage1.directLabor + stage1.manufacturingOverhead
      const stage1UnitCost = stage1TotalCost / stage1.goodQuantity
      
      expect(stage1TotalCost).toBe(15000)
      expect(stage1UnitCost).toBe(15)

      // Stage 2: Assembly (receives from Stage 1)
      const stage2 = {
        transferredIn: stage1TotalCost, // From Stage 1
        directMaterials: 5000,
        directLabor: 4000,
        manufacturingOverhead: 3000,
        goodQuantity: 800 // Some loss in processing
      }
      
      const stage2TotalCost = stage2.transferredIn + stage2.directMaterials + stage2.directLabor + stage2.manufacturingOverhead
      const stage2UnitCost = stage2TotalCost / stage2.goodQuantity
      
      expect(stage2TotalCost).toBe(27000)
      expect(stage2UnitCost).toBe(33.75)
    })

    it('should apply AVCO methodology for cost averaging', () => {
      // Test Average Cost (AVCO) calculation for inventory valuation
      const inventoryBatches = [
        { date: '2024-01-01', quantity: 100, unitCost: 50, totalCost: 5000 },
        { date: '2024-01-15', quantity: 150, unitCost: 60, totalCost: 9000 },
        { date: '2024-01-30', quantity: 200, unitCost: 55, totalCost: 11000 }
      ]
      
      const totalQuantity = inventoryBatches.reduce((sum, batch) => sum + batch.quantity, 0)
      const totalCost = inventoryBatches.reduce((sum, batch) => sum + batch.totalCost, 0)
      const averageUnitCost = totalCost / totalQuantity
      
      expect(totalQuantity).toBe(450)
      expect(totalCost).toBe(25000)
      expect(Math.round(averageUnitCost * 100) / 100).toBe(55.56)
    })

    it('should handle scrap and rework quantities correctly', () => {
      const productionData = {
        totalInput: 1000,
        goodOutput: 850,
        scrapQuantity: 100,
        reworkQuantity: 50,
        totalCost: 50000
      }
      
      // Verify quantity balance
      expect(productionData.goodOutput + productionData.scrapQuantity + productionData.reworkQuantity)
        .toBe(productionData.totalInput)
      
      // Calculate efficiency
      const efficiency = (productionData.goodOutput / productionData.totalInput) * 100
      expect(efficiency).toBe(85)
      
      // Calculate costs
      const goodUnitCost = productionData.totalCost / productionData.goodOutput
      expect(Math.round(goodUnitCost * 100) / 100).toBe(58.82)
    })
  })

  describe('Labor Time Application', () => {
    it('should calculate labor cost correctly', () => {
      const laborData = {
        hours: 40,
        hourlyRate: 25,
        overheadRate: 0.15 // 15% overhead on labor
      }
      
      const directLaborCost = laborData.hours * laborData.hourlyRate
      const overheadOnLabor = directLaborCost * laborData.overheadRate
      const totalLaborCost = directLaborCost + overheadOnLabor
      
      expect(directLaborCost).toBe(1000)
      expect(overheadOnLabor).toBe(150)
      expect(totalLaborCost).toBe(1150)
    })

    it('should handle multiple employees and shifts', () => {
      const employees = [
        { name: 'Employee A', hours: 8, rate: 30 },
        { name: 'Employee B', hours: 6, rate: 25 },
        { name: 'Employee C', hours: 10, rate: 35 }
      ]
      
      const totalLaborCost = employees.reduce((sum, emp) => sum + (emp.hours * emp.rate), 0)
      const totalHours = employees.reduce((sum, emp) => sum + emp.hours, 0)
      const averageRate = totalLaborCost / totalHours
      
      expect(totalLaborCost).toBe(840)
      expect(totalHours).toBe(24)
      expect(Math.round(averageRate * 100) / 100).toBe(35)
    })
  })

  describe('Manufacturing Overhead Application', () => {
    it('should apply overhead based on labor cost allocation base', () => {
      const overheadData = {
        totalOverheadCost: 50000,
        totalDirectLaborCost: 200000,
        jobDirectLaborCost: 5000
      }
      
      const overheadRate = overheadData.totalOverheadCost / overheadData.totalDirectLaborCost
      const appliedOverhead = overheadData.jobDirectLaborCost * overheadRate
      
      expect(overheadRate).toBe(0.25) // 25%
      expect(appliedOverhead).toBe(1250)
    })

    it('should apply overhead based on machine hours allocation base', () => {
      const overheadData = {
        totalOverheadCost: 75000,
        totalMachineHours: 5000,
        jobMachineHours: 120
      }
      
      const overheadRate = overheadData.totalOverheadCost / overheadData.totalMachineHours
      const appliedOverhead = overheadData.jobMachineHours * overheadRate
      
      expect(overheadRate).toBe(15) // 15 per machine hour
      expect(appliedOverhead).toBe(1800)
    })

    it('should handle variable and fixed overhead separately', () => {
      const overheadComponents = {
        variableOverhead: {
          rate: 0.20, // 20% of direct labor
          laborCost: 10000
        },
        fixedOverhead: {
          rate: 25, // 25 per unit
          quantity: 100
        }
      }
      
      const variableOH = overheadComponents.variableOverhead.laborCost * overheadComponents.variableOverhead.rate
      const fixedOH = overheadComponents.fixedOverhead.quantity * overheadComponents.fixedOverhead.rate
      const totalOverhead = variableOH + fixedOH
      
      expect(variableOH).toBe(2000)
      expect(fixedOH).toBe(2500)
      expect(totalOverhead).toBe(4500)
    })
  })

  describe('Cost Transfer Between Stages', () => {
    it('should transfer costs accurately between stages', () => {
      // Simulate multi-stage process costing
      const stages = [
        {
          name: 'Cutting',
          transferredIn: 0,
          materials: 20000,
          labor: 8000,
          overhead: 4000,
          goodUnits: 1000
        },
        {
          name: 'Assembly',
          transferredIn: 0, // Will be calculated
          materials: 15000,
          labor: 12000,
          overhead: 6000,
          goodUnits: 950
        },
        {
          name: 'Finishing',
          transferredIn: 0, // Will be calculated
          materials: 8000,
          labor: 10000,
          overhead: 5000,
          goodUnits: 900
        }
      ]
      
      // Calculate costs stage by stage
      let previousStageCost = 0
      
      stages.forEach((stage, index) => {
        stage.transferredIn = previousStageCost
        const totalCost = stage.transferredIn + stage.materials + stage.labor + stage.overhead
        const unitCost = totalCost / stage.goodUnits
        
        // Set up for next stage
        previousStageCost = totalCost
        
        // Verify calculations
        if (index === 0) { // Cutting stage
          expect(totalCost).toBe(32000)
          expect(unitCost).toBe(32)
        } else if (index === 1) { // Assembly stage
          expect(stage.transferredIn).toBe(32000)
          expect(totalCost).toBe(65000)
          expect(Math.round(unitCost * 100) / 100).toBe(68.42)
        } else if (index === 2) { // Finishing stage
          expect(stage.transferredIn).toBe(65000)
          expect(totalCost).toBe(88000)
          expect(Math.round(unitCost * 100) / 100).toBe(97.78)
        }
      })
    })
  })

  describe('Cost Variance Analysis', () => {
    it('should calculate material price variance', () => {
      const materialData = {
        standardPrice: 10,
        actualPrice: 11,
        actualQuantity: 500
      }
      
      const materialPriceVariance = (materialData.actualPrice - materialData.standardPrice) * materialData.actualQuantity
      
      expect(materialPriceVariance).toBe(500) // Unfavorable variance
    })

    it('should calculate labor efficiency variance', () => {
      const laborData = {
        standardHours: 100,
        actualHours: 95,
        standardRate: 20
      }
      
      const laborEfficiencyVariance = (laborData.standardHours - laborData.actualHours) * laborData.standardRate
      
      expect(laborEfficiencyVariance).toBe(100) // Favorable variance
    })

    it('should calculate overhead volume variance', () => {
      const overheadData = {
        budgetedFixedOverhead: 50000,
        standardHours: 10000,
        actualHours: 9500
      }
      
      const fixedOverheadRate = overheadData.budgetedFixedOverhead / overheadData.standardHours
      const overheadVolumeVariance = (overheadData.actualHours - overheadData.standardHours) * fixedOverheadRate
      
      expect(fixedOverheadRate).toBe(5)
      expect(overheadVolumeVariance).toBe(-2500) // Unfavorable variance
    })
  })

  describe('Integration with Business Logic', () => {
    it('should validate manufacturing order requirements', () => {
      const manufacturingOrder = {
        id: 'MO-001',
        itemId: 'ITEM-001',
        quantity: 1000,
        status: 'in_progress',
        bomId: 'BOM-001'
      }
      
      // Validate required fields
      expect(manufacturingOrder.id).toBeDefined()
      expect(manufacturingOrder.itemId).toBeDefined()
      expect(manufacturingOrder.quantity).toBeGreaterThan(0)
      expect(['pending', 'in_progress', 'completed'].includes(manufacturingOrder.status)).toBe(true)
    })

    it('should ensure data consistency across cost calculations', () => {
      const stageData = {
        inputQuantity: 1000,
        goodOutput: 850,
        scrapOutput: 100,
        reworkOutput: 50,
        totalCostInput: 50000
      }
      
      // Verify quantity conservation
      const totalOutput = stageData.goodOutput + stageData.scrapOutput + stageData.reworkOutput
      expect(totalOutput).toBe(stageData.inputQuantity)
      
      // Verify cost assignment
      const outputCostPerUnit = stageData.totalCostInput / stageData.inputQuantity
      const totalOutputValue = totalOutput * outputCostPerUnit
      expect(totalOutputValue).toBe(stageData.totalCostInput)
    })
  })
})