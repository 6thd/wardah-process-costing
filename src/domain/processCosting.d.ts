// Type declarations for processCosting.js

export interface StageCostResult {
  stageId: string
  totalCost: number
  unitCost: number
  transferredIn: number
  laborCost: number
  overheadCost: number
  efficiency: number
  calculatedAt: string
}

export interface LaborTimeResult {
  totalLaborCost: number
}

export interface OverheadResult {
  overheadAmount: number
}

export interface StageCostData {
  stageId?: string
  totalCost?: number
  unitCost?: number
  transferredIn?: number
  laborCost?: number
  overheadCost?: number
}

export function applyLaborTime(params: any): Promise<any>
export function applyOverhead(params: any): Promise<any>
export function upsertStageCost(params: any): Promise<any>
export function getStageCosts(moId: string): Promise<any>