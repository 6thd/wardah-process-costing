// types/manufacturing.ts
export interface ManufacturingOrder {
  id: string;
  org_id: string;
  mo_number: string;
  product_id: string;
  qty_planned: number;
  qty_produced: number;
  status: 'draft' | 'in_progress' | 'done' | 'cancelled';
  work_center?: string;
  start_ts?: string;
  end_ts?: string;
  created_at: string;
  updated_at: string;
}

export interface StageCost {
  id: string;
  mo_id: string;
  stage_number: number;
  work_center: string;
  dm_cost: number;
  dl_cost: number;
  moh_cost: number;
  total_cost: number;
  unit_cost: number;
  efficiency_rate: number;
  quality_rate: number;
}