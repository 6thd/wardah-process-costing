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

    const materialCost = materials.reduce((t, i) => t + i.totalCost, 0);
    const laborCost = labor.reduce((t, i) => t + i.totalCost, 0);
    const overheadCost = overhead.reduce((t, i) => t + i.amount, 0);

    const costBreakdown = CostBreakdown.create(materialCost, laborCost, overheadCost, quantity || 1, currency);
    return { costBreakdown, details: { materialItems: materials.length, laborEntries: labor.length, overheadEntries: overhead.length } };
  }
}
