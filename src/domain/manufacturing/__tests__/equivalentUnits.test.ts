/**
 * Equivalent Units Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EquivalentUnitsService } from '../equivalentUnits'

// Mock the imports
vi.mock('../../core/security.ts', () => ({
  createSecureRPC: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({}))
}))

vi.mock('../../core/supabase', () => ({
  getSupabase: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: {}, error: null })
  }),
  getTenantId: vi.fn().mockResolvedValue('test-tenant-id')
}))

vi.mock('../../core/config', () => ({
  getTableName: vi.fn().mockImplementation((name) => name)
}))

describe('EquivalentUnitsService', () => {
  let service: EquivalentUnitsService

  beforeEach(() => {
    service = new EquivalentUnitsService()
  })

  it('should create an instance of EquivalentUnitsService', () => {
    expect(service).toBeInstanceOf(EquivalentUnitsService)
  })

  it('should calculate equivalent units', async () => {
    const result = await service.calculateEquivalentUnits(
      'mo-1',
      10,
      1000, // beginningWip
      10000, // unitsStarted
      9500, // unitsCompleted
      1500, // endingWip
      100, // materialCompletionPct
      80 // conversionCompletionPct
    )

    expect(result).toHaveProperty('equivalentUnitsMaterial')
    expect(result).toHaveProperty('equivalentUnitsConversion')
  })

  it('should calculate cost per equivalent unit', async () => {
    const result = await service.calculateCostPerEquivalentUnit(
      'mo-1',
      10,
      '2023-06-01',
      '2023-06-30'
    )

    expect(result).toHaveProperty('materialCost')
    expect(result).toHaveProperty('laborCost')
    expect(result).toHaveProperty('overheadCost')
    expect(result).toHaveProperty('totalCost')
    expect(result).toHaveProperty('equivalentUnitsMaterial')
    expect(result).toHaveProperty('equivalentUnitsConversion')
    expect(result).toHaveProperty('costPerEquivalentUnitMaterial')
    expect(result).toHaveProperty('costPerEquivalentUnitConversion')
  })

  it('should perform variance analysis', async () => {
    const result = await service.performVarianceAnalysis('mo-1', 10)

    expect(result).toHaveProperty('moId')
    expect(result).toHaveProperty('stageNo')
    expect(result).toHaveProperty('varianceDate')
    expect(result).toHaveProperty('standardMaterialCost')
    expect(result).toHaveProperty('standardLaborCost')
    expect(result).toHaveProperty('standardOverheadCost')
    expect(result).toHaveProperty('actualMaterialCost')
    expect(result).toHaveProperty('actualLaborCost')
    expect(result).toHaveProperty('actualOverheadCost')
    expect(result).toHaveProperty('materialCostVariance')
    expect(result).toHaveProperty('laborCostVariance')
    expect(result).toHaveProperty('overheadCostVariance')
    expect(result).toHaveProperty('totalVariance')
    expect(result).toHaveProperty('materialVariancePercentage')
    expect(result).toHaveProperty('laborVariancePercentage')
    expect(result).toHaveProperty('overheadVariancePercentage')
    expect(result).toHaveProperty('varianceSeverity')
  })

  it('should create a production batch', async () => {
    const batch = {
      batchNumber: 'BATCH-001',
      productId: 'item-1',
      startDate: '2023-06-01',
      plannedQuantity: 10000,
      status: 'PLANNED' as const,
      priorityLevel: 1
    }

    const result = await service.createProductionBatch(batch)

    expect(result).toHaveProperty('id')
    expect(result.batchNumber).toBe(batch.batchNumber)
    expect(result.productId).toBe(batch.productId)
    expect(result.startDate).toBe(batch.startDate)
    expect(result.plannedQuantity).toBe(batch.plannedQuantity)
    expect(result.status).toBe(batch.status)
    expect(result.priorityLevel).toBe(batch.priorityLevel)
  })

  it('should get production batches', async () => {
    const result = await service.getProductionBatches()

    expect(Array.isArray(result)).toBe(true)
  })
})