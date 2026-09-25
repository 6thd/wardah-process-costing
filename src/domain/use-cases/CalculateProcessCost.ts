/**
 * CalculateProcessCost Use Case - Domain Layer
 */

import { CostBreakdown } from '../entities/CostBreakdown';
import type { IProcessCostingRepository } from '../interfaces/IProcessCostingRepository';

export interface CostingInput {
  moId: string;
  currency?: string;
}

export interface CostingResult {
  costBreakdown: CostBreakdown;
  details: { materialItems: number; laborEntries: number; overheadEntries: number; };
}

export class CalculateProcessCostUseCase {
  constructor(private readonly repository: IProcessCostingRepository) {}

  async execute(input: CostingInput): Promise<CostingResult> {
    const { moId, currency = 'SAR' } = input;
    const [materials, labor, overhead, quantity] = await Promise.all([
      this.repository.getDirectMaterials(moId),
      this.repository.getDirectLabor(moId),
      this.repository.getOverheadCosts(moId),
      this.repository.getManufacturingOrderQuantity(moId)
    ]);

    // An invalid manufacturing quantity (0, negative, NaN, missing — including the
    // repository's 0-on-error answer) is never converted into 1: per-unit cost
    // over a fabricated quantity is a wrong number, not a safe default.
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid manufacturing order quantity for ${moId}: ${String(quantity)}`);
    }

    const materialCost = materials.reduce((t, i) => t + i.totalCost, 0);
    const laborCost = labor.reduce((t, i) => t + i.totalCost, 0);
    const overheadCost = overhead.reduce((t, i) => t + i.amount, 0);

    const costBreakdown = CostBreakdown.create(materialCost, laborCost, overheadCost, quantity, currency);
    return { costBreakdown, details: { materialItems: materials.length, laborEntries: labor.length, overheadEntries: overhead.length } };
  }
}
