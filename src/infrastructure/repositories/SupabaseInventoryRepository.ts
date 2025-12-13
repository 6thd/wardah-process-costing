/**
 * SupabaseInventoryRepository - Infrastructure Implementation (Adapter)
 * 
 * تنفيذ Repository Pattern للمخزون باستخدام Supabase
 */

import { supabase } from '@/lib/supabase'
import type {
  IInventoryRepository,
  ProductData,
  BinData,
  StockMovementData,
  StockBalanceData,
  AvailabilityCheckResult,
} from '@/domain/interfaces/IInventoryRepository'
import type { StockBatch } from '@/services/valuation'

export class SupabaseInventoryRepository implements IInventoryRepository {
  
  // ===== Product Operations =====
  
  async getProduct(productId: string): Promise<ProductData | null> {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null // Not found
      throw new Error(`فشل في جلب المنتج: ${error.message}`)
    }

    return this.mapProduct(data)
  }

  async getProductByCode(code: string): Promise<ProductData | null> {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('code', code)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`فشل في جلب المنتج بالكود: ${error.message}`)
    }

    return this.mapProduct(data)
  }

  async getProducts(filters?: { category?: string; active?: boolean }): Promise<ProductData[]> {
    let query = supabase.from('products').select('*')

    if (filters?.category) {
      query = query.eq('category', filters.category)
    }
    if (filters?.active !== undefined) {
      query = query.eq('is_active', filters.active)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`فشل في جلب المنتجات: ${error.message}`)
    }

    return (data || []).map(this.mapProduct)
  }

  async updateProductStock(
    productId: string,
    quantity: number,
    rate: number,
    value: number,
    queue?: StockBatch[]
  ): Promise<void> {
    const updateData: any = {
      stock_quantity: quantity,
      cost_price: rate,
      stock_value: value,
      updated_at: new Date().toISOString(),
    }

    if (queue) {
      updateData.stock_queue = queue
    }

    const { error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', productId)

    if (error) {
      throw new Error(`فشل في تحديث مخزون المنتج: ${error.message}`)
    }
  }

  // ===== Bin Operations =====

  async getBin(productId: string, warehouseId: string): Promise<BinData | null> {
    const { data, error } = await supabase
      .from('bins')
      .select('*')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`فشل في جلب الحاوية: ${error.message}`)
    }

    return this.mapBin(data)
  }

  async getBinsByProduct(productId: string): Promise<BinData[]> {
    const { data, error } = await supabase
      .from('bins')
      .select('*')
      .eq('product_id', productId)

    if (error) {
      throw new Error(`فشل في جلب حاويات المنتج: ${error.message}`)
    }

    return (data || []).map(this.mapBin)
  }

  async getBinsByWarehouse(warehouseId: string): Promise<BinData[]> {
    const { data, error } = await supabase
      .from('bins')
      .select('*')
      .eq('warehouse_id', warehouseId)

    if (error) {
      throw new Error(`فشل في جلب حاويات المستودع: ${error.message}`)
    }

    return (data || []).map(this.mapBin)
  }

  async updateBin(binId: string, data: Partial<BinData>): Promise<void> {
    const updateData: any = {}
    
    if (data.actualQty !== undefined) updateData.actual_qty = data.actualQty
    if (data.reservedQty !== undefined) updateData.reserved_qty = data.reservedQty
    if (data.availableQty !== undefined) updateData.available_qty = data.availableQty
    if (data.stockValue !== undefined) updateData.stock_value = data.stockValue
    if (data.avgRate !== undefined) updateData.avg_rate = data.avgRate
    updateData.updated_at = new Date().toISOString()

    const { error } = await supabase
      .from('bins')
      .update(updateData)
      .eq('id', binId)

    if (error) {
      throw new Error(`فشل في تحديث الحاوية: ${error.message}`)
    }
  }

  async createBin(data: Omit<BinData, 'id'>): Promise<BinData> {
    const insertData = {
      product_id: data.productId,
      warehouse_id: data.warehouseId,
      actual_qty: data.actualQty,
      reserved_qty: data.reservedQty,
      available_qty: data.availableQty,
      stock_value: data.stockValue,
      avg_rate: data.avgRate,
    }

    const { data: result, error } = await supabase
      .from('bins')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      throw new Error(`فشل في إنشاء الحاوية: ${error.message}`)
    }

    return this.mapBin(result)
  }

  // ===== Stock Movements =====

  async recordStockMovement(movement: StockMovementData): Promise<StockMovementData> {
    const insertData = {
      product_id: movement.productId,
      warehouse_id: movement.warehouseId,
      bin_id: movement.binId,
      move_type: movement.moveType,
      quantity: movement.quantity,
      rate: movement.rate,
      total_value: movement.totalValue,
      reference_type: movement.referenceType,
      reference_id: movement.referenceId,
      notes: movement.notes,
    }

    const { data, error } = await supabase
      .from('stock_movements')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      throw new Error(`فشل في تسجيل حركة المخزون: ${error.message}`)
    }

    return this.mapStockMovement(data)
  }

  async getStockMovements(
    productId: string,
    options?: {
      fromDate?: string
      toDate?: string
      warehouseId?: string
      moveType?: 'IN' | 'OUT' | 'TRANSFER'
    }
  ): Promise<StockMovementData[]> {
    let query = supabase
      .from('stock_movements')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })

    if (options?.fromDate) {
      query = query.gte('created_at', options.fromDate)
    }
    if (options?.toDate) {
      query = query.lte('created_at', options.toDate)
    }
    if (options?.warehouseId) {
      query = query.eq('warehouse_id', options.warehouseId)
    }
    if (options?.moveType) {
      query = query.eq('move_type', options.moveType)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`فشل في جلب حركات المخزون: ${error.message}`)
    }

    return (data || []).map(this.mapStockMovement)
  }

  // ===== Stock Queries =====

  async getStockBalance(productId: string, warehouseId?: string): Promise<StockBalanceData> {
    let query = supabase
      .from('bins')
      .select(`
        product_id,
        actual_qty,
        stock_value,
        avg_rate,
        product:products(code, name),
        warehouse:warehouses(name)
      `)
      .eq('product_id', productId)

    if (warehouseId) {
      query = query.eq('warehouse_id', warehouseId)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`فشل في جلب رصيد المخزون: ${error.message}`)
    }

    const totalQty = data?.reduce((sum, bin) => sum + (bin.actual_qty || 0), 0) || 0
    const totalValue = data?.reduce((sum, bin) => sum + (bin.stock_value || 0), 0) || 0
    const avgRate = totalQty > 0 ? totalValue / totalQty : 0

    return {
      productId,
      productCode: (data?.[0]?.product as any)?.code || '',
      productName: (data?.[0]?.product as any)?.name || '',
      warehouseId,
      warehouseName: warehouseId ? (data?.[0]?.warehouse as any)?.name : undefined,
      quantity: totalQty,
      avgRate,
      totalValue,
    }
  }

  async getTotalStockValue(warehouseId?: string): Promise<number> {
    let query = supabase.from('bins').select('stock_value')

    if (warehouseId) {
      query = query.eq('warehouse_id', warehouseId)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`فشل في حساب إجمالي قيمة المخزون: ${error.message}`)
    }

    return (data || []).reduce((sum, bin) => sum + (bin.stock_value || 0), 0)
  }

  async getLowStockItems(threshold = 10): Promise<ProductData[]> {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .lt('stock_quantity', threshold)
      .gt('stock_quantity', 0)
      .order('stock_quantity')

    if (error) {
      throw new Error(`فشل في جلب المنتجات منخفضة المخزون: ${error.message}`)
    }

    return (data || []).map(this.mapProduct)
  }

  // ===== Availability =====

  async checkAvailability(
    requirements: Array<{ productId: string; quantity: number }>
  ): Promise<AvailabilityCheckResult[]> {
    const results: AvailabilityCheckResult[] = []

    for (const req of requirements) {
      const { data, error } = await supabase
        .from('bins')
        .select('available_qty')
        .eq('product_id', req.productId)

      if (error) {
        throw new Error(`فشل في التحقق من التوفر: ${error.message}`)
      }

      const availableQty = (data || []).reduce((sum, bin) => sum + (bin.available_qty || 0), 0)
      const isAvailable = availableQty >= req.quantity
      const shortfall = isAvailable ? 0 : req.quantity - availableQty

      results.push({
        productId: req.productId,
        requiredQty: req.quantity,
        availableQty,
        isAvailable,
        shortfall,
      })
    }

    return results
  }

  // ===== Reservations =====

  async createReservation(
    productId: string,
    quantity: number,
    referenceType: string,
    referenceId: string
  ): Promise<string> {
    const { data, error } = await supabase
      .from('stock_reservations')
      .insert({
        product_id: productId,
        quantity,
        reference_type: referenceType,
        reference_id: referenceId,
        status: 'active',
      })
      .select('id')
      .single()

    if (error) {
      throw new Error(`فشل في إنشاء الحجز: ${error.message}`)
    }

    return data.id
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const { error } = await supabase
      .from('stock_reservations')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('id', reservationId)

    if (error) {
      throw new Error(`فشل في إلغاء الحجز: ${error.message}`)
    }
  }

  async getReservations(
    productId: string
  ): Promise<Array<{ id: string; quantity: number; referenceType: string; referenceId: string }>> {
    const { data, error } = await supabase
      .from('stock_reservations')
      .select('id, quantity, reference_type, reference_id')
      .eq('product_id', productId)
      .eq('status', 'active')

    if (error) {
      throw new Error(`فشل في جلب الحجوزات: ${error.message}`)
    }

    return (data || []).map(r => ({
      id: r.id,
      quantity: r.quantity,
      referenceType: r.reference_type,
      referenceId: r.reference_id,
    }))
  }

  // ===== Private Mappers =====

  private mapProduct(data: any): ProductData {
    return {
      id: data.id,
      code: data.code,
      name: data.name,
      nameAr: data.name_ar,
      valuationMethod: data.valuation_method || 'AVCO',
      stockQuantity: data.stock_quantity || 0,
      costPrice: data.cost_price || 0,
      stockValue: data.stock_value || 0,
      stockQueue: data.stock_queue,
      minStockLevel: data.min_stock_level,
      maxStockLevel: data.max_stock_level,
      reorderPoint: data.reorder_point,
      category: data.category,
      unit: data.unit,
    }
  }

  private mapBin(data: any): BinData {
    return {
      id: data.id,
      productId: data.product_id,
      warehouseId: data.warehouse_id,
      actualQty: data.actual_qty || 0,
      reservedQty: data.reserved_qty || 0,
      availableQty: data.available_qty || 0,
      stockValue: data.stock_value || 0,
      avgRate: data.avg_rate || 0,
      lastMovementDate: data.last_movement_date,
    }
  }

  private mapStockMovement(data: any): StockMovementData {
    return {
      id: data.id,
      productId: data.product_id,
      warehouseId: data.warehouse_id,
      binId: data.bin_id,
      moveType: data.move_type,
      quantity: data.quantity || 0,
      rate: data.rate || 0,
      totalValue: data.total_value || 0,
      referenceType: data.reference_type,
      referenceId: data.reference_id,
      notes: data.notes,
      createdAt: data.created_at,
      createdBy: data.created_by,
    }
  }
}

/**
 * Singleton instance
 */
export const inventoryRepository = new SupabaseInventoryRepository()
