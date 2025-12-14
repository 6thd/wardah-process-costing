/**
 * SupabaseProcessCostingRepository - Infrastructure Layer
 * 
 * Implements IProcessCostingRepositoryExtended using Supabase.
 * This is an adapter that connects the domain to the database.
 */

import { supabase } from '@/lib/supabase';
import type {
  IProcessCostingRepository,
  DirectMaterialData,
  DirectLaborData,
  OverheadCostData
} from '@/domain/interfaces/IProcessCostingRepository';
import type { IProcessCostingRepositoryExtended } from '@/application/services/ProcessCostingAppService';
import type { StageCostResult } from '@/domain/interfaces/IProcessCostingService';

/**
 * SupabaseProcessCostingRepository
 * 
 * Infrastructure adapter for process costing data access.
 */
export class SupabaseProcessCostingRepository implements IProcessCostingRepositoryExtended {
  /**
   * Get direct materials for a manufacturing order
   */
  async getDirectMaterials(moId: string): Promise<DirectMaterialData[]> {
    const { data, error } = await supabase
      .from('mo_material_issues')
      .select(`
        id,
        item_id,
        quantity,
        unit_cost,
        total_cost,
        products:item_id (name)
      `)
      .eq('mo_id', moId);

    if (error) {
      console.error('Error fetching direct materials:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      itemId: row.item_id,
      itemName: row.products?.name || 'Unknown',
      quantity: row.quantity || 0,
      unitCost: row.unit_cost || 0,
      totalCost: row.total_cost || 0
    }));
  }

  /**
   * Get direct labor for a manufacturing order
   */
  async getDirectLabor(moId: string): Promise<DirectLaborData[]> {
    const { data, error } = await supabase
      .from('labor_time_logs')
      .select('*')
      .eq('mo_id', moId);

    if (error) {
      console.error('Error fetching direct labor:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      hours: row.hours || 0,
      hourlyRate: row.hourly_rate || 0,
      totalCost: row.total_cost || (row.hours * row.hourly_rate) || 0
    }));
  }

  /**
   * Get overhead costs for a manufacturing order
   */
  async getOverheadCosts(moId: string): Promise<OverheadCostData[]> {
    const { data, error } = await supabase
      .from('moh_applied')
      .select('*')
      .eq('mo_id', moId);

    if (error) {
      console.error('Error fetching overhead costs:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      type: row.overhead_type || 'variable',
      description: row.notes || 'Manufacturing Overhead',
      amount: row.amount || (row.base_qty * row.overhead_rate) || 0,
      allocationBase: row.allocation_base,
      allocationRate: row.overhead_rate
    }));
  }

  /**
   * Get manufacturing order quantity
   */
  async getManufacturingOrderQuantity(moId: string): Promise<number> {
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .select('quantity')
      .eq('id', moId)
      .single();

    if (error) {
      console.error('Error fetching MO quantity:', error);
      return 0;
    }

    return data?.quantity || 0;
  }

  /**
   * Get stage number from stage ID
   */
  async getStageNumber(stageId: string): Promise<number | null> {
    const { data, error } = await supabase
      .from('manufacturing_stages')
      .select('order_sequence')
      .eq('id', stageId)
      .single();

    if (error) {
      console.error('Error fetching stage number:', error);
      return null;
    }

    return data?.order_sequence || null;
  }

  /**
   * Get default work center for organization
   */
  async getDefaultWorkCenter(orgId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('work_centers')
      .select('id')
      .eq('org_id', orgId)
      .limit(1)
      .single();

    if (error) {
      console.error('Error fetching default work center:', error);
      return null;
    }

    return data?.id || null;
  }

  /**
   * Insert labor time log
   */
  async insertLaborTimeLog(params: {
    orgId: string;
    moId: string;
    stageNo: number;
    workCenterId: string;
    hours: number;
    hourlyRate: number;
    employeeName?: string;
    operationCode?: string;
    notes?: string;
  }): Promise<{ id: string } | null> {
    const { data, error } = await supabase
      .from('labor_time_logs')
      .insert({
        tenant_id: params.orgId,
        mo_id: params.moId,
        stage_no: params.stageNo,
        wc_id: params.workCenterId,
        hours: params.hours,
        hourly_rate: params.hourlyRate,
        employee_name: params.employeeName || 'غير محدد',
        operation_code: params.operationCode || null,
        notes: params.notes || null,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error && !error.message.includes('Could not find')) {
      console.error('Error inserting labor time log:', error);
      return null;
    }

    return data ? { id: data.id } : null;
  }

  /**
   * Insert overhead applied record
   */
  async insertOverheadApplied(params: {
    orgId: string;
    moId: string;
    stageNo: number;
    workCenterId: string;
    baseQty: number;
    overheadRate: number;
    overheadType?: string;
    notes?: string;
  }): Promise<{ id: string } | null> {
    const { data, error } = await supabase
      .from('moh_applied')
      .insert({
        tenant_id: params.orgId,
        mo_id: params.moId,
        stage_no: params.stageNo,
        wc_id: params.workCenterId,
        allocation_base: 'labor_cost',
        base_qty: params.baseQty,
        overhead_rate: params.overheadRate,
        overhead_type: params.overheadType || 'variable',
        notes: params.notes || null,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error && !error.message.includes('Could not find')) {
      console.error('Error inserting overhead applied:', error);
      return null;
    }

    return data ? { id: data.id } : null;
  }

  /**
   * Get labor costs for a stage
   */
  async getLaborCostsByStage(moId: string, stageNo: number): Promise<number> {
    const { data, error } = await supabase
      .from('labor_time_logs')
      .select('total_cost, hours, hourly_rate')
      .eq('mo_id', moId)
      .eq('stage_no', stageNo);

    if (error) {
      console.error('Error fetching labor costs:', error);
      return 0;
    }

    return (data || []).reduce((sum, log) => {
      const cost = log.total_cost || (log.hours * log.hourly_rate) || 0;
      return sum + Number(cost);
    }, 0);
  }

  /**
   * Get overhead costs for a stage
   */
  async getOverheadCostsByStage(moId: string, stageNo: number): Promise<number> {
    const { data, error } = await supabase
      .from('moh_applied')
      .select('amount, base_qty, overhead_rate')
      .eq('mo_id', moId)
      .eq('stage_no', stageNo);

    if (error) {
      console.error('Error fetching overhead costs:', error);
      return 0;
    }

    return (data || []).reduce((sum, moh) => {
      const amount = moh.amount || (moh.base_qty * moh.overhead_rate) || 0;
      return sum + Number(amount);
    }, 0);
  }

  /**
   * Upsert stage cost record
   */
  async upsertStageCostRecord(params: {
    orgId: string;
    moId: string;
    stageId?: string;
    stageNo?: number;
    workCenterId?: string;
    goodQty: number;
    scrapQty: number;
    materialCost: number;
    laborCost: number;
    overheadCost: number;
    totalCost: number;
    unitCost: number;
    status: string;
  }): Promise<StageCostResult | null> {
    const stageCostData: Record<string, unknown> = {
      org_id: params.orgId,
      manufacturing_order_id: params.moId,
      work_center_id: params.workCenterId || null,
      good_quantity: params.goodQty,
      defective_quantity: params.scrapQty,
      material_cost: params.materialCost,
      labor_cost: params.laborCost,
      overhead_cost: params.overheadCost,
      total_cost: params.totalCost,
      unit_cost: params.unitCost,
      status: params.status,
      updated_at: new Date().toISOString()
    };

    if (params.stageId) {
      stageCostData.stage_id = params.stageId;
    }
    if (params.stageNo) {
      stageCostData.stage_number = params.stageNo;
    }

    // Determine conflict columns
    let conflictColumns = 'manufacturing_order_id,stage_number,org_id';
    if (params.stageId) {
      conflictColumns = 'manufacturing_order_id,stage_id,org_id';
    }

    const { data, error } = await supabase
      .from('stage_costs')
      .upsert(stageCostData, { onConflict: conflictColumns })
      .select()
      .single();

    if (error && !error.message.includes('Could not find')) {
      console.error('Error upserting stage cost:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      manufacturing_order_id: data.manufacturing_order_id,
      stage_id: data.stage_id,
      stage_number: data.stage_number,
      work_center_id: data.work_center_id,
      good_quantity: data.good_quantity,
      scrap_quantity: data.defective_quantity || 0,
      material_cost: data.material_cost,
      labor_cost: data.labor_cost,
      overhead_cost: data.overhead_cost,
      total_cost: data.total_cost,
      unit_cost: data.unit_cost,
      status: data.status
    };
  }

  /**
   * Get all stage costs for a manufacturing order
   */
  async getStageCostsByMO(moId: string): Promise<StageCostResult[]> {
    const { data, error } = await supabase
      .from('stage_costs')
      .select('*')
      .eq('manufacturing_order_id', moId)
      .order('stage_number', { ascending: true });

    if (error && !error.message.includes('Could not find')) {
      console.error('Error fetching stage costs:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      manufacturing_order_id: row.manufacturing_order_id,
      stage_id: row.stage_id,
      stage_number: row.stage_number,
      work_center_id: row.work_center_id,
      good_quantity: row.good_quantity,
      scrap_quantity: row.defective_quantity || 0,
      material_cost: row.material_cost,
      labor_cost: row.labor_cost,
      overhead_cost: row.overhead_cost,
      total_cost: row.total_cost,
      unit_cost: row.unit_cost,
      status: row.status
    }));
  }

  /**
   * Get manufacturing order details
   */
  async getManufacturingOrderDetails(moId: string): Promise<{
    orderNumber: string;
    productName: string;
    plannedQty: number;
    completedQty: number;
    standardCost?: number;
  } | null> {
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .select(`
        order_number,
        quantity,
        completed_quantity,
        products:product_id (name, standard_cost)
      `)
      .eq('id', moId)
      .single();

    if (error) {
      console.error('Error fetching MO details:', error);
      return null;
    }

    const product = data?.products as any;
    return {
      orderNumber: data?.order_number || 'Unknown',
      productName: product?.name || 'Unknown',
      plannedQty: data?.quantity || 0,
      completedQty: data?.completed_quantity || 0,
      standardCost: product?.standard_cost
    };
  }
}
