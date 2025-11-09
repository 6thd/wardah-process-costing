/**
 * Stock Ledger Service - Frontend API
 * تكامل مع نظام Stock Ledger Entry (SLE) في قاعدة البيانات
 * 
 * Based on ERPNext Stock Ledger Entry pattern
 */

import { supabase } from '@/lib/supabase';

// =====================================================
// Types & Interfaces
// =====================================================

export interface StockLedgerEntry {
  id?: string;
  voucher_type: string;  // 'Goods Receipt', 'Delivery Note', 'Stock Entry'
  voucher_id: string;
  voucher_number?: string;
  product_id: string;
  warehouse_id: string;
  posting_date: string;  // Date in ISO format
  posting_time?: string;
  actual_qty: number;  // +ve for IN, -ve for OUT
  qty_after_transaction?: number;  // Running balance
  incoming_rate?: number;
  outgoing_rate?: number;
  valuation_rate?: number;
  stock_value?: number;
  stock_value_difference?: number;
  stock_queue?: any[];  // FIFO/LIFO queue
  batch_no?: string;
  serial_nos?: string[];
  is_cancelled?: boolean;
  docstatus?: number;  // 0=Draft, 1=Submitted, 2=Cancelled
  org_id?: string;
}

export interface Bin {
  id?: string;
  product_id: string;
  warehouse_id: string;
  actual_qty: number;
  reserved_qty: number;
  ordered_qty: number;
  planned_qty: number;
  projected_qty: number;
  valuation_rate: number;
  stock_value: number;
  stock_queue?: any[];
}

export interface StockBalance {
  quantity: number;
  valuation_rate: number;
  stock_value: number;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  name_ar?: string;
  warehouse_type: string;
  parent_warehouse_id?: string;
  is_group: boolean;
  is_active: boolean;
}

// =====================================================
// Warehouse Functions
// =====================================================

/**
 * Get all active warehouses
 */
export async function getWarehouses(): Promise<{ success: boolean; data?: Warehouse[]; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_active', true)
      .order('code');

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error loading warehouses:', error);
    return { success: false, error };
  }
}

/**
 * Get warehouse by ID
 */
export async function getWarehouse(warehouseId: string): Promise<{ success: boolean; data?: Warehouse; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('id', warehouseId)
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error loading warehouse:', error);
    return { success: false, error };
  }
}

// =====================================================
// Stock Balance Functions
// =====================================================

/**
 * Get current stock balance for a product in a warehouse
 * يستخدم PostgreSQL Function: get_stock_balance()
 */
export async function getStockBalance(
  productId: string,
  warehouseId: string
): Promise<{ success: boolean; data?: StockBalance; error?: any }> {
  try {
    const { data, error } = await supabase
      .rpc('get_stock_balance', {
        p_product_id: productId,
        p_warehouse_id: warehouseId
      });

    if (error) throw error;

    // RPC returns array, get first item
    const balance = data && data.length > 0 ? data[0] : {
      quantity: 0,
      valuation_rate: 0,
      stock_value: 0
    };

    return { success: true, data: balance };
  } catch (error) {
    console.error('Error getting stock balance:', error);
    return { success: false, error };
  }
}

/**
 * Get stock balance at a specific date
 * يستخدم PostgreSQL Function: get_stock_balance_at_date()
 */
export async function getStockBalanceAtDate(
  productId: string,
  warehouseId: string,
  date: string
): Promise<{ success: boolean; data?: StockBalance; error?: any }> {
  try {
    const { data, error } = await supabase
      .rpc('get_stock_balance_at_date', {
        p_product_id: productId,
        p_warehouse_id: warehouseId,
        p_posting_date: date
      });

    if (error) throw error;

    const balance = data && data.length > 0 ? data[0] : {
      quantity: 0,
      valuation_rate: 0,
      stock_value: 0
    };

    return { success: true, data: balance };
  } catch (error) {
    console.error('Error getting stock balance at date:', error);
    return { success: false, error };
  }
}

/**
 * Get bin for a product-warehouse combination
 */
export async function getBin(
  productId: string,
  warehouseId: string
): Promise<{ success: boolean; data?: Bin; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('bins')
      .select('*')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .single();

    if (error) {
      // Bin might not exist yet
      if (error.code === 'PGRST116') {
        return { 
          success: true, 
          data: {
            product_id: productId,
            warehouse_id: warehouseId,
            actual_qty: 0,
            reserved_qty: 0,
            ordered_qty: 0,
            planned_qty: 0,
            projected_qty: 0,
            valuation_rate: 0,
            stock_value: 0
          } as Bin
        };
      }
      throw error;
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error loading bin:', error);
    return { success: false, error };
  }
}

/**
 * Get all bins for a product across all warehouses
 */
export async function getProductBins(productId: string): Promise<{ success: boolean; data?: Bin[]; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('bins')
      .select(`
        *,
        warehouse:warehouses(code, name, name_ar)
      `)
      .eq('product_id', productId)
      .order('warehouse_id');

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error loading product bins:', error);
    return { success: false, error };
  }
}

// =====================================================
// Stock Ledger Entry Functions
// =====================================================

/**
 * Create a Stock Ledger Entry
 * ⚠️ This should normally be called from backend/PostgreSQL triggers
 * Use with caution!
 */
export async function createStockLedgerEntry(
  entry: StockLedgerEntry
): Promise<{ success: boolean; data?: StockLedgerEntry; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('stock_ledger_entries')
      .insert({
        voucher_type: entry.voucher_type,
        voucher_id: entry.voucher_id,
        voucher_number: entry.voucher_number,
        product_id: entry.product_id,
        warehouse_id: entry.warehouse_id,
        posting_date: entry.posting_date,
        posting_time: entry.posting_time || new Date().toISOString().split('T')[1].split('.')[0],
        actual_qty: entry.actual_qty,
        qty_after_transaction: entry.qty_after_transaction || 0,
        incoming_rate: entry.incoming_rate || 0,
        outgoing_rate: entry.outgoing_rate || 0,
        valuation_rate: entry.valuation_rate || 0,
        stock_value: entry.stock_value || 0,
        stock_value_difference: entry.stock_value_difference || 0,
        stock_queue: entry.stock_queue || null,
        batch_no: entry.batch_no,
        serial_nos: entry.serial_nos,
        is_cancelled: entry.is_cancelled || false,
        docstatus: entry.docstatus || 1,
        org_id: entry.org_id
      })
      .select()
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error creating stock ledger entry:', error);
    return { success: false, error };
  }
}

/**
 * Get Stock Ledger Entries for a product
 */
export async function getStockLedgerEntries(
  productId: string,
  warehouseId?: string,
  limit = 100
): Promise<{ success: boolean; data?: StockLedgerEntry[]; error?: any }> {
  try {
    let query = supabase
      .from('stock_ledger_entries')
      .select('*')
      .eq('product_id', productId)
      .eq('is_cancelled', false)
      .order('posting_date', { ascending: false })
      .order('posting_time', { ascending: false })
      .limit(limit);

    if (warehouseId) {
      query = query.eq('warehouse_id', warehouseId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error loading stock ledger entries:', error);
    return { success: false, error };
  }
}

/**
 * Get Stock Aging Report
 * يستخدم PostgreSQL Function: get_stock_aging()
 */
export async function getStockAging(
  warehouseId?: string,
  categoryId?: string
): Promise<{ success: boolean; data?: any[]; error?: any }> {
  try {
    const { data, error } = await supabase
      .rpc('get_stock_aging', {
        p_warehouse_id: warehouseId || null,
        p_category_id: categoryId || null
      });

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error getting stock aging:', error);
    return { success: false, error };
  }
}

// =====================================================
// Utility Functions
// =====================================================

/**
 * Calculate total stock value across all warehouses
 */
export async function getTotalStockValue(): Promise<{ success: boolean; data?: number; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('bins')
      .select('stock_value');

    if (error) throw error;

    const total = data?.reduce((sum, bin) => sum + (bin.stock_value || 0), 0) || 0;

    return { success: true, data: total };
  } catch (error) {
    console.error('Error calculating total stock value:', error);
    return { success: false, error };
  }
}

/**
 * Get low stock items (actual_qty < some threshold)
 */
export async function getLowStockItems(threshold = 10): Promise<{ success: boolean; data?: any[]; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('bins')
      .select(`
        *,
        product:products(code, name, name_ar, min_stock_level),
        warehouse:warehouses(code, name)
      `)
      .lt('actual_qty', threshold)
      .gt('actual_qty', 0)
      .order('actual_qty');

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error loading low stock items:', error);
    return { success: false, error };
  }
}
