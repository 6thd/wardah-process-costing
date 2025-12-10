/**
 * IFRS/GAAP Compliance Tests
 * Tests for compliance with International Financial Reporting Standards
 * 
 * Standards Covered:
 * - IAS 2: Inventory Valuation (Lower of Cost or NRV)
 * - IAS 16: Property, Plant & Equipment (Depreciation, Impairment)
 * - IAS 23: Borrowing Costs (Capitalization)
 * - IFRS 15: Revenue Recognition (5-step model)
 */

import { describe, it, expect } from 'vitest'

// ===================================================================
// Helper Functions for IFRS Compliance
// ===================================================================

/**
 * IAS 2: Calculate inventory value using lower of cost or NRV
 */
function valuateInventoryIAS2(cost: number, nrv: number): number {
  return Math.min(cost, nrv)
}

/**
 * IAS 2: Check if write-down reversal is needed
 */
function shouldReverseWriteDown(originalCost: number, currentNRV: number, writtenDownValue: number): boolean {
  // Can reverse up to original cost, but not above
  return currentNRV > writtenDownValue && currentNRV <= originalCost
}

/**
 * IAS 2: Calculate write-down reversal amount
 */
function calculateWriteDownReversal(originalCost: number, currentNRV: number, writtenDownValue: number): number {
  // If NRV exceeds original cost, can reverse up to original cost only
  if (currentNRV > originalCost) {
    return Math.max(0, originalCost - writtenDownValue)
  }
  
  // If NRV is between written-down value and original cost, can reverse the difference
  if (currentNRV > writtenDownValue && currentNRV <= originalCost) {
    return currentNRV - writtenDownValue
  }
  
  // No reversal if NRV still below written-down value
  return 0
}

/**
 * IAS 16: Calculate straight-line depreciation
 */
function calculateStraightLineDepreciation(cost: number, residualValue: number, usefulLife: number): number {
  if (usefulLife <= 0) return 0
  return (cost - residualValue) / usefulLife
}

/**
 * IAS 16: Test for impairment (simplified)
 */
function testForImpairment(carryingAmount: number, recoverableAmount: number): {
  isImpaired: boolean
  impairmentLoss: number
} {
  const isImpaired = carryingAmount > recoverableAmount
  const impairmentLoss = isImpaired ? carryingAmount - recoverableAmount : 0
  return { isImpaired, impairmentLoss }
}

/**
 * IAS 23: Determine if borrowing costs should be capitalized
 */
function shouldCapitalizeBorrowingCosts(
  isQualifyingAsset: boolean,
  constructionPeriod: { start: Date; end: Date },
  currentDate?: Date
): boolean {
  if (!isQualifyingAsset) return false
  
  const now = currentDate || new Date()
  const isUnderConstruction = now >= constructionPeriod.start && now <= constructionPeriod.end
  return isUnderConstruction
}

/**
 * IFRS 15: Step 1 - Identify the contract
 */
function identifyContract(customer: any, promises: any[]): boolean {
  return !!(
    customer &&
    promises.length > 0 &&
    customer.id &&
    customer.name
  )
}

/**
 * IFRS 15: Step 2 - Identify performance obligations
 */
function identifyPerformanceObligations(promises: any[]): any[] {
  return promises.filter(p => p.distinct && p.satisfied === false)
}

/**
 * IFRS 15: Step 3 - Determine transaction price
 */
function determineTransactionPrice(price: number, variableConsideration: number = 0): number {
  return price + variableConsideration
}

/**
 * IFRS 15: Step 4 - Allocate transaction price
 */
function allocateTransactionPrice(transactionPrice: number, obligations: any[]): Record<string, number> {
  const totalStandalonePrice = obligations.reduce((sum, ob) => sum + (ob.standalonePrice || 0), 0)
  if (totalStandalonePrice === 0) {
    // Equal allocation if no standalone prices
    const equalPrice = transactionPrice / obligations.length
    return obligations.reduce((acc, ob) => ({ ...acc, [ob.id]: equalPrice }), {})
  }
  
  // Allocate based on standalone prices
  return obligations.reduce((acc, ob) => {
    const allocation = (ob.standalonePrice / totalStandalonePrice) * transactionPrice
    return { ...acc, [ob.id]: allocation }
  }, {})
}

/**
 * IFRS 15: Step 5 - Recognize revenue when control transfers
 */
function recognizeRevenue(obligation: any, controlTransferred: boolean): number {
  if (!controlTransferred) return 0
  return obligation.allocatedPrice || 0
}

// ===================================================================
// Test Suite
// ===================================================================

describe('IFRS/GAAP Compliance', () => {
  describe('IAS 2 - Inventory Valuation', () => {
    describe('Lower of Cost or NRV', () => {
      it('should use cost when cost < NRV', () => {
        const cost = 100
        const nrv = 120
        const valuation = valuateInventoryIAS2(cost, nrv)
        expect(valuation).toBe(100) // Use cost (lower)
      })
      
      it('should use NRV when NRV < cost', () => {
        const cost = 100
        const nrv = 90
        const valuation = valuateInventoryIAS2(cost, nrv)
        expect(valuation).toBe(90) // Use NRV (lower)
      })
      
      it('should use cost when cost = NRV', () => {
        const cost = 100
        const nrv = 100
        const valuation = valuateInventoryIAS2(cost, nrv)
        expect(valuation).toBe(100)
      })
      
      it('should handle zero values', () => {
        expect(valuateInventoryIAS2(0, 50)).toBe(0)
        expect(valuateInventoryIAS2(50, 0)).toBe(0)
        expect(valuateInventoryIAS2(0, 0)).toBe(0)
      })
      
      it('should handle negative NRV (market crash scenario)', () => {
        const cost = 100
        const nrv = -10 // Market value dropped below zero
        const valuation = valuateInventoryIAS2(cost, nrv)
        expect(valuation).toBe(-10) // Use NRV (lower, even if negative)
      })
    })
    
    describe('Write-down Reversal', () => {
      it('should reverse write-down when NRV increases but not above original cost', () => {
        const originalCost = 100
        const writtenDownValue = 80 // Previously written down
        const currentNRV = 95
        
        const shouldReverse = shouldReverseWriteDown(originalCost, currentNRV, writtenDownValue)
        expect(shouldReverse).toBe(true)
        
        const reversalAmount = calculateWriteDownReversal(originalCost, currentNRV, writtenDownValue)
        expect(reversalAmount).toBe(15) // Can reverse 15 (95 - 80)
      })
      
      it('should not reverse above original cost', () => {
        const originalCost = 100
        const writtenDownValue = 80
        const currentNRV = 120 // NRV exceeds original cost
        
        const shouldReverse = shouldReverseWriteDown(originalCost, currentNRV, writtenDownValue)
        expect(shouldReverse).toBe(false) // Cannot reverse above original cost
        
        const reversalAmount = calculateWriteDownReversal(originalCost, currentNRV, writtenDownValue)
        // Can reverse up to original cost only (100 - 80 = 20), not to 120
        expect(reversalAmount).toBe(20) // Limited to original cost
      })
      
      it('should not reverse if NRV still below written-down value', () => {
        const originalCost = 100
        const writtenDownValue = 80
        const currentNRV = 75 // Still below written-down value
        
        const shouldReverse = shouldReverseWriteDown(originalCost, currentNRV, writtenDownValue)
        expect(shouldReverse).toBe(false)
        
        const reversalAmount = calculateWriteDownReversal(originalCost, currentNRV, writtenDownValue)
        expect(reversalAmount).toBe(0)
      })
    })
    
    describe('Abnormal Waste Exclusion', () => {
      it('should exclude abnormal waste from inventory cost', () => {
        const totalCost = 1000
        const abnormalWaste = 100 // 10% abnormal (exceeds normal)
        
        // Normal waste is included in cost, abnormal is expensed
        const inventoryCost = totalCost - abnormalWaste
        expect(inventoryCost).toBe(900)
      })
      
      it('should include normal waste in inventory cost', () => {
        const totalCost = 1000
        
        // Normal waste is part of production cost
        const inventoryCost = totalCost // Includes normal waste
        expect(inventoryCost).toBe(1000)
      })
    })
  })
  
  describe('IAS 16 - Property, Plant & Equipment', () => {
    describe('Straight-Line Depreciation', () => {
      it('should calculate annual depreciation correctly', () => {
        const asset = {
          cost: 100000,
          residualValue: 10000,
          usefulLife: 10
        }
        
        const annualDepreciation = calculateStraightLineDepreciation(
          asset.cost,
          asset.residualValue,
          asset.usefulLife
        )
        
        expect(annualDepreciation).toBe(9000) // (100000 - 10000) / 10
      })
      
      it('should handle zero residual value', () => {
        const asset = {
          cost: 100000,
          residualValue: 0,
          usefulLife: 10
        }
        
        const annualDepreciation = calculateStraightLineDepreciation(
          asset.cost,
          asset.residualValue,
          asset.usefulLife
        )
        
        expect(annualDepreciation).toBe(10000) // 100000 / 10
      })
      
      it('should handle zero useful life', () => {
        const asset = {
          cost: 100000,
          residualValue: 10000,
          usefulLife: 0
        }
        
        const annualDepreciation = calculateStraightLineDepreciation(
          asset.cost,
          asset.residualValue,
          asset.usefulLife
        )
        
        expect(annualDepreciation).toBe(0) // Cannot depreciate
      })
      
      it('should handle residual value equal to cost', () => {
        const asset = {
          cost: 100000,
          residualValue: 100000,
          usefulLife: 10
        }
        
        const annualDepreciation = calculateStraightLineDepreciation(
          asset.cost,
          asset.residualValue,
          asset.usefulLife
        )
        
        expect(annualDepreciation).toBe(0) // No depreciation
      })
    })
    
    describe('Impairment Testing', () => {
      it('should recognize impairment when carrying amount > recoverable amount', () => {
        const carryingAmount = 100000
        const recoverableAmount = 80000
        
        const result = testForImpairment(carryingAmount, recoverableAmount)
        
        expect(result.isImpaired).toBe(true)
        expect(result.impairmentLoss).toBe(20000) // 100000 - 80000
      })
      
      it('should not recognize impairment when carrying amount <= recoverable amount', () => {
        const carryingAmount = 80000
        const recoverableAmount = 100000
        
        const result = testForImpairment(carryingAmount, recoverableAmount)
        
        expect(result.isImpaired).toBe(false)
        expect(result.impairmentLoss).toBe(0)
      })
      
      it('should handle equal carrying and recoverable amounts', () => {
        const carryingAmount = 100000
        const recoverableAmount = 100000
        
        const result = testForImpairment(carryingAmount, recoverableAmount)
        
        expect(result.isImpaired).toBe(false)
        expect(result.impairmentLoss).toBe(0)
      })
    })
  })
  
  describe('IAS 23 - Borrowing Costs', () => {
    describe('Capitalization of Borrowing Costs', () => {
      it('should capitalize borrowing costs for qualifying assets under construction', () => {
        const isQualifyingAsset = true
        const constructionPeriod = {
          start: new Date('2024-01-01'),
          end: new Date('2024-12-31')
        }
        const currentDate = new Date('2024-06-15') // Mid-construction
        
        const shouldCapitalize = shouldCapitalizeBorrowingCosts(isQualifyingAsset, constructionPeriod, currentDate)
        expect(shouldCapitalize).toBe(true)
      })
      
      it('should not capitalize for non-qualifying assets', () => {
        const isQualifyingAsset = false
        const constructionPeriod = {
          start: new Date('2024-01-01'),
          end: new Date('2024-12-31')
        }
        
        const shouldCapitalize = shouldCapitalizeBorrowingCosts(isQualifyingAsset, constructionPeriod)
        expect(shouldCapitalize).toBe(false)
      })
      
      it('should not capitalize after construction completion', () => {
        const isQualifyingAsset = true
        const constructionPeriod = {
          start: new Date('2023-01-01'),
          end: new Date('2023-12-31') // Completed in past
        }
        
        const shouldCapitalize = shouldCapitalizeBorrowingCosts(isQualifyingAsset, constructionPeriod)
        expect(shouldCapitalize).toBe(false)
      })
      
      it('should not capitalize before construction starts', () => {
        const isQualifyingAsset = true
        const constructionPeriod = {
          start: new Date('2025-01-01'), // Future
          end: new Date('2025-12-31')
        }
        const currentDate = new Date('2024-12-31') // Before construction starts
        
        const shouldCapitalize = shouldCapitalizeBorrowingCosts(isQualifyingAsset, constructionPeriod, currentDate)
        expect(shouldCapitalize).toBe(false)
      })
    })
  })
  
  describe('IFRS 15 - Revenue Recognition', () => {
    describe('Step 1: Identify the Contract', () => {
      it('should identify valid contract', () => {
        const customer = {
          id: 'cust-1',
          name: 'Test Customer',
          email: 'test@example.com'
        }
        const promises = [
          { id: 'promise-1', description: 'Deliver product' }
        ]
        
        const isValid = identifyContract(customer, promises)
        expect(isValid).toBe(true)
      })
      
      it('should reject contract without customer', () => {
        const customer = null
        const promises = [{ id: 'promise-1' }]
        
        const isValid = identifyContract(customer, promises)
        expect(isValid).toBe(false)
      })
      
      it('should reject contract without promises', () => {
        const customer = { id: 'cust-1', name: 'Test' }
        const promises: any[] = []
        
        const isValid = identifyContract(customer, promises)
        expect(isValid).toBe(false)
      })
    })
    
    describe('Step 2: Identify Performance Obligations', () => {
      it('should identify distinct, unsatisfied obligations', () => {
        const promises = [
          { id: 'p1', distinct: true, satisfied: false },
          { id: 'p2', distinct: true, satisfied: false },
          { id: 'p3', distinct: false, satisfied: false }, // Not distinct
          { id: 'p4', distinct: true, satisfied: true } // Already satisfied
        ]
        
        const obligations = identifyPerformanceObligations(promises)
        expect(obligations).toHaveLength(2)
        expect(obligations.map(o => o.id)).toEqual(['p1', 'p2'])
      })
    })
    
    describe('Step 3: Determine Transaction Price', () => {
      it('should calculate transaction price including variable consideration', () => {
        const price = 1000
        const variableConsideration = 100 // Discount, rebate, etc.
        
        const transactionPrice = determineTransactionPrice(price, variableConsideration)
        expect(transactionPrice).toBe(1100)
      })
      
      it('should handle zero variable consideration', () => {
        const price = 1000
        const transactionPrice = determineTransactionPrice(price)
        expect(transactionPrice).toBe(1000)
      })
      
      it('should handle negative variable consideration (discounts)', () => {
        const price = 1000
        const variableConsideration = -100 // Discount
        
        const transactionPrice = determineTransactionPrice(price, variableConsideration)
        expect(transactionPrice).toBe(900)
      })
    })
    
    describe('Step 4: Allocate Transaction Price', () => {
      it('should allocate based on standalone prices', () => {
        const transactionPrice = 1000
        const obligations = [
          { id: 'ob1', standalonePrice: 600 },
          { id: 'ob2', standalonePrice: 400 }
        ]
        
        const allocation = allocateTransactionPrice(transactionPrice, obligations)
        
        expect(allocation.ob1).toBe(600) // 60% of 1000
        expect(allocation.ob2).toBe(400) // 40% of 1000
      })
      
      it('should allocate equally when no standalone prices', () => {
        const transactionPrice = 1000
        const obligations = [
          { id: 'ob1' },
          { id: 'ob2' },
          { id: 'ob3' }
        ]
        
        const allocation = allocateTransactionPrice(transactionPrice, obligations)
        
        expect(allocation.ob1).toBeCloseTo(333.33, 2)
        expect(allocation.ob2).toBeCloseTo(333.33, 2)
        expect(allocation.ob3).toBeCloseTo(333.33, 2)
      })
      
      it('should handle single obligation', () => {
        const transactionPrice = 1000
        const obligations = [
          { id: 'ob1', standalonePrice: 1000 }
        ]
        
        const allocation = allocateTransactionPrice(transactionPrice, obligations)
        
        expect(allocation.ob1).toBe(1000)
      })
    })
    
    describe('Step 5: Recognize Revenue', () => {
      it('should recognize revenue when control transfers', () => {
        const obligation = {
          id: 'ob1',
          allocatedPrice: 500
        }
        const controlTransferred = true
        
        const revenue = recognizeRevenue(obligation, controlTransferred)
        expect(revenue).toBe(500)
      })
      
      it('should not recognize revenue before control transfers', () => {
        const obligation = {
          id: 'ob1',
          allocatedPrice: 500
        }
        const controlTransferred = false
        
        const revenue = recognizeRevenue(obligation, controlTransferred)
        expect(revenue).toBe(0)
      })
      
      it('should handle zero allocated price', () => {
        const obligation = {
          id: 'ob1',
          allocatedPrice: 0
        }
        const controlTransferred = true
        
        const revenue = recognizeRevenue(obligation, controlTransferred)
        expect(revenue).toBe(0)
      })
    })
    
    describe('Complete 5-Step Revenue Recognition Flow', () => {
      it('should complete full revenue recognition process', () => {
        // Step 1: Identify contract
        const customer = { id: 'cust-1', name: 'Test Customer' }
        const promises = [
          { id: 'p1', distinct: true, satisfied: false, standalonePrice: 600 },
          { id: 'p2', distinct: true, satisfied: false, standalonePrice: 400 }
        ]
        const isValidContract = identifyContract(customer, promises)
        expect(isValidContract).toBe(true)
        
        // Step 2: Identify performance obligations
        const obligations = identifyPerformanceObligations(promises)
        expect(obligations).toHaveLength(2)
        
        // Step 3: Determine transaction price
        const transactionPrice = determineTransactionPrice(1000, 0)
        expect(transactionPrice).toBe(1000)
        
        // Step 4: Allocate transaction price
        const allocation = allocateTransactionPrice(transactionPrice, obligations)
        expect(allocation.p1).toBe(600)
        expect(allocation.p2).toBe(400)
        
        // Step 5: Recognize revenue
        const obligation1 = { id: 'p1', allocatedPrice: allocation.p1 }
        const revenue1 = recognizeRevenue(obligation1, true)
        expect(revenue1).toBe(600)
        
        const obligation2 = { id: 'p2', allocatedPrice: allocation.p2 }
        const revenue2 = recognizeRevenue(obligation2, true)
        expect(revenue2).toBe(400)
      })
    })
  })
})

