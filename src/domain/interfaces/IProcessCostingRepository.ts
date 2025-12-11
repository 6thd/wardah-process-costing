/**
 * IProcessCostingRepository - Domain Interface (Port)
 */

export interface DirectMaterialData {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface DirectLaborData {
  id: string;
  employeeId?: string;
  employeeName?: string;
  hours: number;
  hourlyRate: number;
  totalCost: number;
}

export interface OverheadCostData {
  id: string;
  type: string;
  description: string;
  amount: number;
  allocationBase?: string;
  allocationRate?: number;
}

export interface IProcessCostingRepository {
  getDirectMaterials(moId: string): Promise<DirectMaterialData[]>;
  getDirectLabor(moId: string): Promise<DirectLaborData[]>;
  getOverheadCosts(moId: string): Promise<OverheadCostData[]>;
  getManufacturingOrderQuantity(moId: string): Promise<number>;
}
