/**
 * SupabaseProcessCostingRepository - Infrastructure Implementation (Adapter)
 * 
 * تنفيذ Repository Pattern لـ Process Costing باستخدام Supabase
 * يفصل منطق الأعمال عن تفاصيل قاعدة البيانات
 */

import { supabase } from '@/lib/supabase'
import type {
  IProcessCostingRepository,
  DirectMaterialData,
  DirectLaborData,
  OverheadCostData,
} from '@/domain/interfaces/IProcessCostingRepository'

export class SupabaseProcessCostingRepository implements IProcessCostingRepository {
  /**
   * الحصول على المواد المباشرة لأمر تصنيع
   */
  async getDirectMaterials(moId: string): Promise<DirectMaterialData[]> {
    const { data, error } = await supabase
      .from('mo_materials')
      .select(`
        id,
        item_id,
        quantity,
        unit_cost,
        total_cost,
        product:products(name, name_ar)
      `)
      .eq('mo_id', moId)

    if (error) {
      console.error('Error fetching direct materials:', error)
      throw new Error(`فشل في جلب المواد المباشرة: ${error.message}`)
    }

    return (data || []).map(item => ({
      id: item.id,
      itemId: item.item_id,
      itemName: (item.product as any)?.name || (item.product as any)?.name_ar || 'Unknown',
      quantity: item.quantity || 0,
      unitCost: item.unit_cost || 0,
      totalCost: item.total_cost || 0,
    }))
  }

  /**
   * الحصول على العمالة المباشرة لأمر تصنيع
   */
  async getDirectLabor(moId: string): Promise<DirectLaborData[]> {
    const { data, error } = await supabase
      .from('mo_labor')
      .select(`
        id,
        employee_id,
        hours,
        hourly_rate,
        total_cost,
        employee:employees(name, name_ar)
      `)
      .eq('mo_id', moId)

    if (error) {
      console.error('Error fetching direct labor:', error)
      throw new Error(`فشل في جلب العمالة المباشرة: ${error.message}`)
    }

    return (data || []).map(item => ({
      id: item.id,
      employeeId: item.employee_id,
      employeeName: (item.employee as any)?.name || (item.employee as any)?.name_ar,
      hours: item.hours || 0,
      hourlyRate: item.hourly_rate || 0,
      totalCost: item.total_cost || 0,
    }))
  }

  /**
   * الحصول على التكاليف الصناعية غير المباشرة لأمر تصنيع
   */
  async getOverheadCosts(moId: string): Promise<OverheadCostData[]> {
    const { data, error } = await supabase
      .from('mo_overhead')
      .select(`
        id,
        overhead_type,
        description,
        amount,
        allocation_base,
        allocation_rate
      `)
      .eq('mo_id', moId)

    if (error) {
      console.error('Error fetching overhead costs:', error)
      throw new Error(`فشل في جلب التكاليف غير المباشرة: ${error.message}`)
    }

    return (data || []).map(item => ({
      id: item.id,
      type: item.overhead_type || 'General',
      description: item.description || '',
      amount: item.amount || 0,
      allocationBase: item.allocation_base,
      allocationRate: item.allocation_rate,
    }))
  }

  /**
   * الحصول على كمية الإنتاج لأمر تصنيع
   */
  async getManufacturingOrderQuantity(moId: string): Promise<number> {
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .select('quantity')
      .eq('id', moId)
      .single()

    if (error) {
      console.error('Error fetching MO quantity:', error)
      throw new Error(`فشل في جلب كمية أمر التصنيع: ${error.message}`)
    }

    return data?.quantity || 0
  }
}

/**
 * Singleton instance للاستخدام في التطبيق
 */
export const processCostingRepository = new SupabaseProcessCostingRepository()
