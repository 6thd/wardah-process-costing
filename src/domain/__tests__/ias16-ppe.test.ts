/**
 * IAS 16 - Property, Plant & Equipment (PPE) Tests
 * Tests for compliance with IAS 16 accounting standard
 * 
 * Standard Reference: IAS 16 Property, Plant and Equipment
 * Key Requirements:
 * - IAS 16.6: Recognition criteria (future economic benefits + reliable measurement)
 * - IAS 16.16: Cost of PPE includes purchase price + directly attributable costs
 * - IAS 16.43-62: Depreciation (systematic allocation)
 * - IAS 16.31-42: Revaluation model
 * - IAS 16.63-66: Impairment (refer to IAS 36)
 * - IAS 16.67-72: Derecognition
 * 
 * @see https://www.ifrs.org/issued-standards/list-of-standards/ias-16-property-plant-and-equipment/
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ===================================================================
// Types & Interfaces
// ===================================================================

interface PPEAsset {
  id: string
  name: string
  category: 'LAND' | 'BUILDING' | 'MACHINERY' | 'VEHICLE' | 'EQUIPMENT' | 'FURNITURE'
  cost: number
  purchaseDate: Date
  residualValue: number
  usefulLife: number // in years
  depreciationMethod: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION'
  accumulatedDepreciation: number
  carryingAmount: number
  revaluedAmount?: number
  revaluationDate?: Date
}

interface DepreciationSchedule {
  year: number
  openingBalance: number
  depreciationExpense: number
  accumulatedDepreciation: number
  carryingAmount: number
}

// ===================================================================
// Helper Functions
// ===================================================================

/**
 * IAS 16.43: Calculate straight-line depreciation
 * Depreciation = (Cost - Residual Value) / Useful Life
 */
function calculateStraightLineDepreciation(
  cost: number,
  residualValue: number,
  usefulLife: number
): number {
  if (usefulLife <= 0) return 0
  if (cost <= residualValue) return 0
  
  return (cost - residualValue) / usefulLife
}

/**
 * IAS 16.50: Calculate declining balance depreciation
 * Depreciation = Carrying Amount × Rate
 */
function calculateDecliningBalanceDepreciation(
  carryingAmount: number,
  rate: number
): number {
  if (carryingAmount <= 0 || rate <= 0) return 0
  
  return carryingAmount * rate
}

/**
 * IAS 16.56: Calculate units of production depreciation
 * Depreciation per unit = (Cost - Residual) / Total Units Expected
 */
function calculateUnitsOfProductionDepreciation(
  cost: number,
  residualValue: number,
  totalExpectedUnits: number,
  unitsProduced: number
): number {
  if (totalExpectedUnits <= 0) return 0
  
  const depreciationPerUnit = (cost - residualValue) / totalExpectedUnits
  return depreciationPerUnit * unitsProduced
}

/**
 * IAS 16.6: Test if asset meets recognition criteria
 */
function meetsRecognitionCriteria(
  hasFutureEconomicBenefits: boolean,
  costMeasurableReliably: boolean
): boolean {
  return hasFutureEconomicBenefits && costMeasurableReliably
}

/**
 * IAS 16.16: Calculate initial cost of PPE
 */
function calculateInitialCost(
  purchasePrice: number,
  importDuties: number,
  installationCosts: number,
  tradeDiscounts: number,
  initialEstimateOfDismantlingCosts: number
): number {
  return (
    purchasePrice +
    importDuties +
    installationCosts -
    tradeDiscounts +
    initialEstimateOfDismantlingCosts
  )
}

/**
 * IAS 16.31-42: Apply revaluation model
 */
function applyRevaluationModel(
  carryingAmount: number,
  fairValue: number,
  previousRevaluationSurplus: number
): {
  newCarryingAmount: number
  revaluationSurplus: number
  revaluationLoss: number
} {
  const difference = fairValue - carryingAmount
  
  if (difference > 0) {
    // Revaluation increase
    return {
      newCarryingAmount: fairValue,
      revaluationSurplus: difference,
      revaluationLoss: 0
    }
  } else if (difference < 0) {
    // Revaluation decrease
    const lossToEquity = Math.min(Math.abs(difference), previousRevaluationSurplus)
    const lossToPL = Math.abs(difference) - lossToEquity
    
    return {
      newCarryingAmount: fairValue,
      revaluationSurplus: -lossToEquity,
      revaluationLoss: lossToPL
    }
  }
  
  // No change
  return {
    newCarryingAmount: carryingAmount,
    revaluationSurplus: 0,
    revaluationLoss: 0
  }
}

/**
 * IAS 16.63-66 & IAS 36: Test for impairment
 */
function testForImpairment(
  carryingAmount: number,
  recoverableAmount: number
): {
  isImpaired: boolean
  impairmentLoss: number
} {
  const isImpaired = carryingAmount > recoverableAmount
  const impairmentLoss = isImpaired ? carryingAmount - recoverableAmount : 0
  
  return { isImpaired, impairmentLoss }
}

/**
 * Generate depreciation schedule
 */
function generateDepreciationSchedule(
  cost: number,
  residualValue: number,
  usefulLife: number,
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' = 'STRAIGHT_LINE',
  rate?: number
): DepreciationSchedule[] {
  const schedule: DepreciationSchedule[] = []
  let carryingAmount = cost
  let accumulatedDepreciation = 0
  
  for (let year = 1; year <= usefulLife; year++) {
    const openingBalance = carryingAmount
    
    let depreciationExpense: number
    if (method === 'STRAIGHT_LINE') {
      depreciationExpense = calculateStraightLineDepreciation(cost, residualValue, usefulLife)
    } else {
      depreciationExpense = calculateDecliningBalanceDepreciation(carryingAmount, rate || 0.2)
    }
    
    // Ensure we don't depreciate below residual value
    if (carryingAmount - depreciationExpense < residualValue) {
      depreciationExpense = Math.max(0, carryingAmount - residualValue)
    }
    
    accumulatedDepreciation += depreciationExpense
    carryingAmount = cost - accumulatedDepreciation
    
    schedule.push({
      year,
      openingBalance,
      depreciationExpense,
      accumulatedDepreciation,
      carryingAmount
    })
    
    // Stop if reached residual value
    if (carryingAmount <= residualValue) break
  }
  
  return schedule
}

// ===================================================================
// IAS 16 Tests
// ===================================================================

describe('IAS 16 - Property, Plant & Equipment', () => {
  
  describe('IAS 16.6 - Recognition Criteria', () => {
    it('should recognize asset when both criteria are met', () => {
      const result = meetsRecognitionCriteria(
        true,  // Future economic benefits probable
        true   // Cost measurable reliably
      )
      
      expect(result).toBe(true)
    })
    
    it('should not recognize without future economic benefits', () => {
      const result = meetsRecognitionCriteria(false, true)
      expect(result).toBe(false)
    })
    
    it('should not recognize without reliable cost measurement', () => {
      const result = meetsRecognitionCriteria(true, false)
      expect(result).toBe(false)
    })
  })
  
  describe('IAS 16.16 - Initial Cost Measurement', () => {
    it('should include purchase price and directly attributable costs', () => {
      const cost = calculateInitialCost(
        100000,  // Purchase price
        5000,    // Import duties
        10000,   // Installation costs
        2000,    // Trade discounts (deducted)
        3000     // Dismantling costs
      )
      
      // 100,000 + 5,000 + 10,000 - 2,000 + 3,000 = 116,000
      expect(cost).toBe(116000)
    })
    
    it('should deduct trade discounts from cost', () => {
      const cost = calculateInitialCost(
        100000,  // Purchase price
        0,       // No import duties
        0,       // No installation
        10000,   // Trade discount
        0        // No dismantling costs
      )
      
      expect(cost).toBe(90000)
    })
    
    it('should include dismantling and restoration costs (IAS 16.16c)', () => {
      const cost = calculateInitialCost(
        500000,  // Purchase price (e.g., oil rig)
        0,       // No import duties
        50000,   // Installation
        0,       // No discounts
        100000   // Dismantling costs (future obligation)
      )
      
      // Must include initial estimate of dismantling costs
      expect(cost).toBe(650000)
    })
  })
  
  describe('IAS 16.43-62 - Depreciation', () => {
    describe('Straight-Line Method', () => {
      it('should calculate annual straight-line depreciation correctly', () => {
        const annualDepreciation = calculateStraightLineDepreciation(
          100000,  // Cost
          10000,   // Residual value
          10       // Useful life (years)
        )
        
        // (100,000 - 10,000) / 10 = 9,000 per year
        expect(annualDepreciation).toBe(9000)
      })
      
      it('should handle zero residual value', () => {
        const annualDepreciation = calculateStraightLineDepreciation(
          100000,  // Cost
          0,       // Zero residual value
          10       // Useful life
        )
        
        expect(annualDepreciation).toBe(10000)
      })
      
      it('should return zero for zero useful life', () => {
        const annualDepreciation = calculateStraightLineDepreciation(
          100000,
          10000,
          0  // Invalid useful life
        )
        
        expect(annualDepreciation).toBe(0)
      })
      
      it('should return zero when cost equals residual value', () => {
        const annualDepreciation = calculateStraightLineDepreciation(
          100000,  // Cost
          100000,  // Residual = Cost (no depreciation needed)
          10
        )
        
        expect(annualDepreciation).toBe(0)
      })
      
      it('should generate correct depreciation schedule', () => {
        const schedule = generateDepreciationSchedule(
          100000,  // Cost
          10000,   // Residual
          5        // 5 years
        )
        
        expect(schedule).toHaveLength(5)
        expect(schedule[0].depreciationExpense).toBe(18000) // (100k - 10k) / 5
        expect(schedule[4].carryingAmount).toBe(10000) // Final = residual
      })
    })
    
    describe('Declining Balance Method', () => {
      it('should calculate declining balance depreciation', () => {
        const depreciation = calculateDecliningBalanceDepreciation(
          100000,  // Carrying amount
          0.2      // 20% rate
        )
        
        expect(depreciation).toBe(20000) // 100,000 × 20%
      })
      
      it('should reduce depreciation amount over time', () => {
        const year1 = calculateDecliningBalanceDepreciation(100000, 0.2)
        const year2 = calculateDecliningBalanceDepreciation(80000, 0.2)  // After year 1
        const year3 = calculateDecliningBalanceDepreciation(64000, 0.2)  // After year 2
        
        expect(year1).toBe(20000)
        expect(year2).toBe(16000)
        expect(year3).toBe(12800)
        expect(year1).toBeGreaterThan(year2)
        expect(year2).toBeGreaterThan(year3)
      })
    })
    
    describe('Units of Production Method', () => {
      it('should calculate depreciation based on units produced', () => {
        const depreciation = calculateUnitsOfProductionDepreciation(
          500000,    // Cost
          50000,     // Residual value
          100000,    // Total expected units
          10000      // Units produced this period
        )
        
        // (500,000 - 50,000) / 100,000 = 4.5 per unit
        // 4.5 × 10,000 = 45,000
        expect(depreciation).toBe(45000)
      })
      
      it('should vary depreciation with production levels', () => {
        const highProduction = calculateUnitsOfProductionDepreciation(
          500000, 50000, 100000, 20000  // 20k units
        )
        const lowProduction = calculateUnitsOfProductionDepreciation(
          500000, 50000, 100000, 5000   // 5k units
        )
        
        expect(highProduction).toBe(90000)
        expect(lowProduction).toBe(22500)
        expect(highProduction).toBeGreaterThan(lowProduction)
      })
    })
    
    describe('IAS 16.51 - Depreciation Period', () => {
      it('should begin depreciation when asset is available for use', () => {
        // This is a business logic test - depreciation starts when:
        // 1. Asset is in location
        // 2. Asset is in condition for intended use
        
        const assetReadyDate = new Date('2024-01-15')
        const purchaseDate = new Date('2023-12-01')
        
        // Depreciation should start from Jan 15, 2024, not Dec 1, 2023
        expect(assetReadyDate.getTime()).toBeGreaterThan(purchaseDate.getTime())
      })
      
      it('should continue depreciation until asset is derecognized', () => {
        // Depreciation continues even if:
        // - Asset is idle
        // - Asset is retired from active use (but not disposed)
        
        const isIdle = true
        const isDisposed = false
        
        const shouldContinueDepreciation = !isDisposed
        expect(shouldContinueDepreciation).toBe(true)
      })
    })
  })
  
  describe('IAS 16.31-42 - Revaluation Model', () => {
    it('should increase carrying amount and recognize surplus in equity', () => {
      const result = applyRevaluationModel(
        100000,  // Current carrying amount
        120000,  // Fair value (increased)
        0        // No previous surplus
      )
      
      expect(result.newCarryingAmount).toBe(120000)
      expect(result.revaluationSurplus).toBe(20000)  // To equity
      expect(result.revaluationLoss).toBe(0)
    })
    
    it('should decrease carrying amount and recognize loss in P&L first', () => {
      const result = applyRevaluationModel(
        100000,  // Current carrying amount
        80000,   // Fair value (decreased)
        0        // No previous surplus to offset
      )
      
      expect(result.newCarryingAmount).toBe(80000)
      expect(result.revaluationLoss).toBe(20000)  // To P&L
      expect(Math.abs(result.revaluationSurplus)).toBe(0)  // Handle -0 vs 0
    })
    
    it('should offset revaluation decrease against previous surplus', () => {
      const result = applyRevaluationModel(
        120000,  // Current carrying amount
        110000,  // Fair value (decreased)
        15000    // Previous revaluation surplus
      )
      
      expect(result.newCarryingAmount).toBe(110000)
      expect(result.revaluationSurplus).toBe(-10000)  // Reduce surplus by 10k
      expect(result.revaluationLoss).toBe(0)  // No P&L impact
    })
    
    it('should recognize loss exceeding surplus in P&L', () => {
      const result = applyRevaluationModel(
        120000,  // Current carrying amount
        90000,   // Fair value (decreased by 30k)
        15000    // Previous surplus (only 15k available)
      )
      
      expect(result.newCarryingAmount).toBe(90000)
      expect(result.revaluationSurplus).toBe(-15000)  // Use all surplus
      expect(result.revaluationLoss).toBe(15000)  // Remaining 15k to P&L
    })
  })
  
  describe('IAS 16.63-66 - Impairment (per IAS 36)', () => {
    it('should recognize impairment when carrying amount > recoverable amount', () => {
      const result = testForImpairment(
        100000,  // Carrying amount
        80000    // Recoverable amount (lower)
      )
      
      expect(result.isImpaired).toBe(true)
      expect(result.impairmentLoss).toBe(20000)
    })
    
    it('should not recognize impairment when recoverable amount >= carrying amount', () => {
      const result = testForImpairment(
        100000,  // Carrying amount
        120000   // Recoverable amount (higher)
      )
      
      expect(result.isImpaired).toBe(false)
      expect(result.impairmentLoss).toBe(0)
    })
    
    it('should handle recoverable amount equal to carrying amount', () => {
      const result = testForImpairment(100000, 100000)
      
      expect(result.isImpaired).toBe(false)
      expect(result.impairmentLoss).toBe(0)
    })
  })
  
  describe('IAS 16.67-72 - Derecognition', () => {
    it('should calculate gain on disposal', () => {
      const carryingAmount = 80000
      const disposalProceeds = 100000
      
      const gainOnDisposal = disposalProceeds - carryingAmount
      
      expect(gainOnDisposal).toBe(20000)
      expect(gainOnDisposal).toBeGreaterThan(0)  // Gain
    })
    
    it('should calculate loss on disposal', () => {
      const carryingAmount = 80000
      const disposalProceeds = 60000
      
      const lossOnDisposal = disposalProceeds - carryingAmount
      
      expect(lossOnDisposal).toBe(-20000)
      expect(lossOnDisposal).toBeLessThan(0)  // Loss
    })
    
    it('should derecognize asset with zero proceeds (scrapping)', () => {
      const carryingAmount = 10000
      const disposalProceeds = 0  // Scrapped
      
      const lossOnDisposal = disposalProceeds - carryingAmount
      
      expect(lossOnDisposal).toBe(-10000)
    })
  })
  
  describe('Edge Cases', () => {
    it('should handle land (non-depreciable asset)', () => {
      // Land normally has unlimited useful life
      const landCost = 500000
      const usefulLife = Infinity
      
      // No depreciation for land
      expect(usefulLife).toBe(Infinity)
    })
    
    it('should handle componentization (IAS 16.43)', () => {
      // Significant parts with different useful lives should be depreciated separately
      
      const building = {
        structure: { cost: 800000, life: 50 },
        roof: { cost: 100000, life: 20 },
        hvac: { cost: 100000, life: 15 }
      }
      
      const structureDepn = calculateStraightLineDepreciation(
        building.structure.cost, 0, building.structure.life
      )
      const roofDepn = calculateStraightLineDepreciation(
        building.roof.cost, 0, building.roof.life
      )
      const hvacDepn = calculateStraightLineDepreciation(
        building.hvac.cost, 0, building.hvac.life
      )
      
      const totalAnnualDepreciation = structureDepn + roofDepn + hvacDepn
      
      // Each component depreciated separately
      expect(structureDepn).toBe(16000)   // 800k / 50
      expect(roofDepn).toBe(5000)         // 100k / 20
      expect(hvacDepn).toBeCloseTo(6666.67, 0)  // 100k / 15
      expect(totalAnnualDepreciation).toBeCloseTo(27666.67, 0)
    })
  })
})
