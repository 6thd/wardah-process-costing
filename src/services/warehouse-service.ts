/**
 * ==============================================================================
 * WAREHOUSE MANAGEMENT SERVICE
 * Complete warehouse operations with full accounting integration
 * Based on ERPNext/SAP best practices
 * ==============================================================================
 */

import { getSupabase } from '@/lib/supabase'
import { toast } from 'sonner'

export interface Warehouse {
  id: string
  org_id: string
  code: string
  name: string
  name_ar?: string
  warehouse_type: string
  parent_warehouse_id?: string
  address?: string
  city?: string
  country?: string
  manager_name?: string
  contact_email?: string
  contact_phone?: string
  inventory_account_id?: string
  expense_account_id?: string
  cost_center_id?: string
  is_active: boolean
  is_group: boolean
  allow_negative_stock: boolean
  total_capacity?: number
  capacity_unit?: string
  created_at: string
  updated_at: string
}

export interface StorageLocation {
  id: string
  warehouse_id: string
  code: string
  name: string
  name_ar?: string
  parent_location_id?: string
  location_type?: string
  temperature_controlled: boolean
  capacity?: number
  capacity_unit?: string
  is_active: boolean
  is_pickable: boolean
  is_receivable: boolean
}

export interface StorageBin {
  id: string
  location_id: string
  warehouse_id: string
  bin_code: string
  barcode?: string
  aisle?: string
  rack?: string
  level?: string
  position?: string
  bin_type?: string
  is_occupied: boolean
  is_active: boolean
  is_locked: boolean
}

export interface WarehouseGLMapping {
  warehouse_id: string
  stock_account: string
  stock_adjustment_account?: string
  expenses_included_in_valuation?: string
  default_cogs_account?: string
  cost_center?: string
}

export interface GLAccount {
  id: string
  code: string
  name: string
  category: 'ASSET' | 'EXPENSE' | 'REVENUE' | 'LIABILITY' | 'EQUITY'
}

/**
 * Warehouse Service Class
 */
export class WarehouseService {
  private supabase = getSupabase()

  // ==============================================================================
  // WAREHOUSE CRUD OPERATIONS
  // ==============================================================================

  /**
   * Get all warehouses for current organization
   */
  async getWarehouses(includeInactive = false): Promise<Warehouse[]> {
    try {
      let query = this.supabase
        .from('warehouses')
        .select(`
          *,
          inventory_account:gl_accounts!warehouses_inventory_account_id_fkey(id, code, name, category),
          expense_account:gl_accounts!warehouses_expense_account_id_fkey(id, code, name, category)
        `)
        .order('code', { ascending: true })

      if (!includeInactive) {
        query = query.eq('is_active', true)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    } catch (error: unknown) {
      console.error('Error fetching warehouses:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تحميل المخازن: ' + message)
      return []
    }
  }

  /**
   * Get single warehouse with full details
   */
  async getWarehouse(id: string): Promise<Warehouse | null> {
    try {
      const { data, error } = await this.supabase
        .from('warehouses')
        .select(`
          *,
          inventory_account:gl_accounts!warehouses_inventory_account_id_fkey(*),
          expense_account:gl_accounts!warehouses_expense_account_id_fkey(*),
          gl_mapping:warehouse_gl_mapping(*)
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error fetching warehouse:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تحميل المخزن: ' + message)
      return null
    }
  }

  /**
   * Create new warehouse (accounts created automatically via trigger)
   */
  async createWarehouse(warehouse: Partial<Warehouse>): Promise<Warehouse | null> {
    try {
      const { data, error } = await this.supabase
        .from('warehouses')
        .insert([warehouse])
        .select()
        .single()

      if (error) throw error

      toast.success('✅ تم إنشاء المخزن بنجاح مع الحسابات المحاسبية')
      return data
    } catch (error: unknown) {
      console.error('Error creating warehouse:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل إنشاء المخزن: ' + message)
      return null
    }
  }

  /**
   * Update warehouse
   */
  async updateWarehouse(id: string, updates: Partial<Warehouse>): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('warehouses')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error

      toast.success('✅ تم تحديث المخزن بنجاح')
      return true
    } catch (error: unknown) {
      console.error('Error updating warehouse:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تحديث المخزن: ' + message)
      return false
    }
  }

  /**
   * Deactivate warehouse (soft delete)
   */
  async deactivateWarehouse(id: string): Promise<boolean> {
    try {
      // Check if warehouse has stock
      const { data: stock, error: stockError } = await this.supabase
        .from('stock_ledger_entries')
        .select('id')
        .eq('warehouse_id', id)
        .limit(1)

      if (stockError) throw stockError

      if (stock && stock.length > 0) {
        toast.error('❌ لا يمكن تعطيل مخزن يحتوي على مخزون')
        return false
      }

      const { error } = await this.supabase
        .from('warehouses')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error

      toast.success('✅ تم تعطيل المخزن بنجاح')
      return true
    } catch (error: unknown) {
      console.error('Error deactivating warehouse:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تعطيل المخزن: ' + message)
      return false
    }
  }

  /**
   * Delete warehouse (hard delete - use with caution)
   */
  async deleteWarehouse(id: string): Promise<boolean> {
    try {
      // Check if warehouse has stock
      const { data: stock, error: stockError } = await this.supabase
        .from('stock_ledger_entries')
        .select('id')
        .eq('warehouse_id', id)
        .limit(1)

      if (stockError) throw stockError

      if (stock && stock.length > 0) {
        toast.error('❌ لا يمكن حذف مخزن يحتوي على مخزون')
        return false
      }

      const { error } = await this.supabase
        .from('warehouses')
        .delete()
        .eq('id', id)

      if (error) throw error

      toast.success('✅ تم حذف المخزن بنجاح')
      return true
    } catch (error: unknown) {
      console.error('Error deactivating warehouse:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تعطيل المخزن: ' + message)
      return false
    }
  }

  // ==============================================================================
  // STORAGE LOCATION OPERATIONS
  // ==============================================================================

  /**
   * Get storage locations for warehouse
   */
  async getStorageLocations(warehouseId: string): Promise<StorageLocation[]> {
    try {
      const { data, error } = await this.supabase
        .from('storage_locations')
        .select('*')
        .eq('warehouse_id', warehouseId)
        .order('code', { ascending: true })

      if (error) throw error
      return data || []
    } catch (error: unknown) {
      console.error('Error fetching locations:', error)
      return []
    }
  }

  /**
   * Create storage location
   */
  async createStorageLocation(location: Partial<StorageLocation>): Promise<StorageLocation | null> {
    try {
      const { data, error } = await this.supabase
        .from('storage_locations')
        .insert([location])
        .select()
        .single()

      if (error) throw error

      toast.success('✅ تم إنشاء الموقع بنجاح')
      return data
    } catch (error: unknown) {
      console.error('Error creating location:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل إنشاء الموقع: ' + message)
      return null
    }
  }

  /**
   * Update storage location
   */
  async updateStorageLocation(id: string, updates: Partial<StorageLocation>): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('storage_locations')
        .update(updates)
        .eq('id', id)

      if (error) throw error

      toast.success('✅ تم تحديث الموقع بنجاح')
      return true
    } catch (error: unknown) {
      console.error('Error updating location:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تحديث الموقع: ' + message)
      return false
    }
  }

  /**
   * Delete storage location
   */
  async deleteStorageLocation(id: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('storage_locations')
        .delete()
        .eq('id', id)

      if (error) throw error

      toast.success('✅ تم حذف الموقع بنجاح')
      return true
    } catch (error: unknown) {
      console.error('Error deleting location:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل حذف الموقع: ' + message)
      return false
    }
  }

  // ==============================================================================
  // STORAGE BIN OPERATIONS
  // ==============================================================================

  /**
   * Get storage bins for location or warehouse
   */
  async getStorageBins(locationId?: string, warehouseId?: string): Promise<StorageBin[]> {
    try {
      let query = this.supabase
        .from('storage_bins')
        .select('*, location:storage_locations(code, name)')
        .order('bin_code', { ascending: true })

      if (locationId) {
        query = query.eq('location_id', locationId)
      } else if (warehouseId) {
        query = query.eq('warehouse_id', warehouseId)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    } catch (error: unknown) {
      console.error('Error fetching bins:', error)
      return []
    }
  }

  /**
   * Create storage bin
   */
  async createStorageBin(bin: Partial<StorageBin>): Promise<StorageBin | null> {
    try {
      const { data, error } = await this.supabase
        .from('storage_bins')
        .insert([bin])
        .select()
        .single()

      if (error) throw error

      toast.success('✅ تم إنشاء الصندوق بنجاح')
      return data
    } catch (error: unknown) {
      console.error('Error creating bin:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل إنشاء الصندوق: ' + message)
      return null
    }
  }

  /**
   * Update storage bin
   */
  async updateStorageBin(id: string, updates: Partial<StorageBin>): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('storage_bins')
        .update(updates)
        .eq('id', id)

      if (error) throw error

      toast.success('✅ تم تحديث الصندوق بنجاح')
      return true
    } catch (error: unknown) {
      console.error('Error updating bin:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تحديث الصندوق: ' + message)
      return false
    }
  }

  /**
   * Delete storage bin
   */
  async deleteStorageBin(id: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('storage_bins')
        .delete()
        .eq('id', id)

      if (error) throw error

      toast.success('✅ تم حذف الصندوق بنجاح')
      return true
    } catch (error: unknown) {
      console.error('Error deleting bin:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل حذف الصندوق: ' + message)
      return false
    }
  }

  // ==============================================================================
  // WAREHOUSE ACCOUNTING INTEGRATION
  // ==============================================================================

  /**
   * Get GL accounts by category for account selection
   */
  async getGLAccountsByCategory(category: string): Promise<Record<string, unknown>[]> {
    try {
      const { data, error } = await this.supabase
        .rpc('get_gl_accounts_by_category', {
          p_org_id: '00000000-0000-0000-0000-000000000001', // Get org_id from context
          p_category: category
        })

      if (error) throw error
      return data || []
    } catch (error: unknown) {
      console.error('Error fetching GL accounts:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تحميل الحسابات: ' + message)
      return []
    }
  }

  /**
   * Get suggested accounts for warehouses
   */
  async getSuggestedAccounts(): Promise<Record<string, unknown>[]> {
    try {
      const { data, error } = await this.supabase
        .from('v_suggested_warehouse_accounts')
        .select('*')

      if (error) throw error
      return data || []
    } catch (error: unknown) {
      console.error('Error fetching suggested accounts:', error)
      return []
    }
  }

  /**
   * Update warehouse GL mapping
   */
  async updateWarehouseAccounting(
    warehouseId: string,
    orgId: string,
    accounts: {
      stockAccount?: string
      adjustmentAccount?: string
      expenseAccount?: string
      cogsAccount?: string
      costCenter?: string
    }
  ): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .rpc('update_warehouse_gl_mapping', {
          p_warehouse_id: warehouseId,
          p_org_id: orgId,
          p_stock_account: accounts.stockAccount || null,
          p_stock_adjustment_account: accounts.adjustmentAccount || null,
          p_expense_account: accounts.expenseAccount || null,
          p_cogs_account: accounts.cogsAccount || null,
          p_cost_center: accounts.costCenter || null
        })

      if (error) throw error

      toast.success('✅ تم تحديث الربط المحاسبي بنجاح')
      return true
    } catch (error: unknown) {
      console.error('Error updating warehouse accounting:', error)
      const message = error instanceof Error ? error.message : 'خطأ غير معروف'
      toast.error('فشل تحديث الربط المحاسبي: ' + message)
      return false
    }
  }

  /**
   * Get warehouse GL mapping
   */
  async getWarehouseGLMapping(warehouseId: string): Promise<WarehouseGLMapping | null> {
    try {
      const { data, error } = await this.supabase
        .from('warehouse_gl_mapping')
        .select(`
          *,
          stock_account_info:gl_accounts!warehouse_gl_mapping_stock_account_fkey(*),
          adjustment_account_info:gl_accounts!warehouse_gl_mapping_stock_adjustment_account_fkey(*),
          cogs_account_info:gl_accounts!warehouse_gl_mapping_default_cogs_account_fkey(*)
        `)
        .eq('warehouse_id', warehouseId)
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error fetching GL mapping:', error)
      return null
    }
  }

  /**
   * Get stock value by warehouse (for accounting reports)
   */
  async getStockValueByWarehouse(warehouseId?: string): Promise<Record<string, unknown>[]> {
    try {
      let query = this.supabase
        .from('v_stock_by_warehouse')
        .select('*')

      if (warehouseId) {
        query = query.eq('warehouse_id', warehouseId)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    } catch (error: unknown) {
      console.error('Error fetching stock value:', error)
      return []
    }
  }

  /**
   * Get warehouse utilization report
   */
  async getWarehouseUtilization(): Promise<Record<string, unknown>[]> {
    try {
      const { data, error } = await this.supabase
        .from('v_warehouse_utilization')
        .select('*')
        .order('code', { ascending: true })

      if (error) throw error
      return data || []
    } catch (error: unknown) {
      console.error('Error fetching utilization:', error)
      return []
    }
  }
}

// Export singleton instance
export const warehouseService = new WarehouseService()
