import {
  getSupabase,
  getTenantId,
  type Item,
  type Category,
  type Supplier,
  type Customer,
  type ManufacturingOrder,
  type ProcessCost,
  type PurchaseOrder,
  type SalesOrder,
  type PurchaseOrderItem,
  type SalesOrderItem
} from '../lib/supabase'
import { PerformanceMonitor } from '../lib/performance-monitor'
import { updateManufacturingOrderStatus, createManufacturingOrder, getManufacturingOrderById } from './manufacturing'
import {
  isTableNotFoundError as isManufacturingTableNotFound,
  isRelationshipNotFoundError as isManufacturingRelationshipNotFound,
  handleTableNotFound,
  fetchOrdersSimple,
  extractItemIds,
  fetchRelatedItems,
  attachRelatedItems,
  normalizeOrderStatuses
} from './manufacturing/manufacturing-helpers'
import {
  isTableNotFoundError as isSalesTableNotFound,
  isRelationshipNotFoundError as isSalesRelationshipNotFound,
  fetchSalesOrdersWithRelations,
  fetchSalesOrdersSimple,
  fetchSalesInvoicesAsFallback,
  attachCustomersToOrders
} from './sales/sales-helpers'
import {
  fetchTrialBalanceFromView,
  fetchPostedEntries,
  fetchEntryLines,
  fetchAccountNames,
  calculateTrialBalanceTotals
} from './accounting/trial-balance-helpers'
import {
  calculateTotalAmount,
  updateSalesOrderWithFallback
} from './sales/sales-order-helpers'

// Type aliases for cleaner code
type CategoryInput = Omit<Category, 'id' | 'created_at' | 'updated_at'>
type ItemInput = Omit<Item, 'id' | 'created_at' | 'updated_at'>
type SupplierInput = Omit<Supplier, 'id' | 'created_at' | 'updated_at'>
type CustomerInput = Omit<Customer, 'id' | 'created_at' | 'updated_at'>
type ManufacturingOrderInput = Omit<ManufacturingOrder, 'id' | 'created_at' | 'updated_at'>
type ProcessCostInput = Omit<ProcessCost, 'id' | 'created_at'>
type PurchaseOrderInput = Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>
type PurchaseOrderItemInput = Omit<PurchaseOrderItem, 'id' | 'purchase_order_id' | 'created_at'>
type SalesOrderInput = Omit<SalesOrder, 'id' | 'created_at' | 'updated_at'>
type SalesOrderItemInput = Omit<SalesOrderItem, 'id' | 'sales_order_id' | 'created_at'>

// Get configuration dynamically
const getConfig = async () => {
  const response = await fetch('/config.json')
  if (!response.ok) {
    throw new Error('Failed to load configuration')
  }
  return await response.json()
}

// Helper function to get supabase client
const getClient = async () => {
  const client = getSupabase()
  if (!client) {
    throw new Error('Supabase client not initialized')
  }
  return client
}

// Categories Service
export const categoriesService = {
  getAll: async () => {
    const config = await getConfig()
    const tenantId = await getTenantId()
    const supabase = await getClient()

    let query = supabase
      .from(config.TABLE_NAMES.categories)
      .select('*')
      .order('name')

    if (tenantId) {
      query = query.eq('tenant_id', tenantId)
    }

    const { data, error } = await query

    if (error) throw error
    return data
  },

  create: async (category: CategoryInput) => {
    const config = await getConfig()
    const tenantId = await getTenantId()
    const supabase = await getClient()

    const categoryData = tenantId ? { ...category, tenant_id: tenantId } : category

    const { data, error } = await supabase
      .from(config.TABLE_NAMES.categories)
      .insert(categoryData)
      .select()
      .single()

    if (error) throw error
    return data
  }
}

// Items Service (Enhanced) - Using 'products' table
export const itemsService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  getLowStock: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .filter('stock_quantity', 'lte', 'minimum_stock')

    if (error) throw error
    return data
  },

  getById: async (id: string) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  },

  create: async (item: ItemInput) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('products')
      .insert(item)
      .select()
      .single()

    if (error) throw error
    return data
  },

  update: async (id: string, item: Partial<Item>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('products')
      .update({ ...item, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  updateStock: async (itemId: string, quantity: number, movementType: 'in' | 'out' | 'adjustment', userId: string, notes?: string) => {
    const supabase = await getClient()
    const { data: item } = await supabase
      .from('products')
      .select('stock_quantity')
      .eq('id', itemId)
      .single()

    if (!item) throw new Error('Item not found')

    let newQuantity = item.stock_quantity
    if (movementType === 'in') {
      newQuantity += quantity
    } else if (movementType === 'out') {
      newQuantity -= quantity
    } else {
      newQuantity = quantity
    }

    const { error: updateError } = await supabase
      .from('products')
      .update({
        stock_quantity: newQuantity,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)

    if (updateError) throw updateError

    // Record stock movement
    const { error: movementError } = await supabase
      .from('stock_movements')
      .insert({
        item_id: itemId,
        movement_type: movementType,
        quantity: movementType === 'adjustment' ? quantity - item.stock_quantity : quantity,
        notes,
        created_by: userId
      })

    if (movementError) throw movementError
  },

  delete: async (id: string) => {
    const supabase = await getClient()
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id)

    if (error) throw error
  }
}

// Suppliers Service (using vendors table)
export const suppliersService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .order('name')

    if (error) throw error
    return data
  },

  create: async (supplier: SupplierInput) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('vendors')
      .insert(supplier)
      .select()
      .single()

    if (error) throw error
    return data
  },

  update: async (id: string, supplier: Partial<Supplier>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('vendors')
      .update({ ...supplier, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  }
}

// Customers Service
export const customersService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('name')

    if (error) throw error
    return data
  },

  create: async (customer: CustomerInput) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('customers')
      .insert(customer)
      .select()
      .single()

    if (error) throw error
    return data
  }
}

// Manufacturing Orders Service (Enhanced)
export const manufacturingService = {
  getAll: async (options?: { limit?: number; includeItems?: boolean }) => {
    return PerformanceMonitor.measure('Manufacturing Orders List', async () => {
      try {
        const supabase = await getClient();
        const limit = options?.limit || 100;
        const includeItems = options?.includeItems !== false;

        const orders = await fetchOrdersSimple(supabase, limit);

        if (includeItems && orders.length > 0) {
          const itemIds = extractItemIds(orders);
          const itemsMap = await fetchRelatedItems(supabase, itemIds);
          attachRelatedItems(orders, itemsMap);
        }

        normalizeOrderStatuses(orders);
        return orders;
      } catch (error: unknown) {
        if (isManufacturingTableNotFound(error)) {
          return handleTableNotFound('manufacturing_orders');
        }

        if (isManufacturingRelationshipNotFound(error)) {
          try {
            const supabase = await getClient();
            const orders = await fetchOrdersSimple(supabase, options?.limit || 100);
            normalizeOrderStatuses(orders);
            return orders;
          } catch (e: unknown) {
            if (isManufacturingTableNotFound(e)) {
              return [];
            }
            throw e;
          }
        }

        throw error;
      }
    });
  },

  /**
   * Get manufacturing order by ID with related item data
   * Refactored to use extracted helper module for reduced complexity
   */
  getById: async (id: string) => {
    return getManufacturingOrderById(getClient, id);
  },

  /**
   * Create a manufacturing order with optional material reservation
   * Refactored to use extracted helper module for reduced complexity
   */
  create: async (
    order: ManufacturingOrderInput,
    materials?: Array<{ item_id: string; quantity: number; unit_cost?: number }>
  ) => {
    return createManufacturingOrder(getClient, order, materials);
  },

  /**
   * Update manufacturing order status
   * Refactored to use extracted helper module for reduced complexity
   */
  updateStatus: async (id: string, status: ManufacturingOrder['status'], providedUpdateData?: Record<string, unknown>) => {
    return updateManufacturingOrderStatus(getClient, { id, status, providedUpdateData });
  }
}

// Process Costs Service (Enhanced)
export const processCostService = {
  getByOrderId: async (manufacturingOrderId: string) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('process_costs')
      .select('*')
      .eq('manufacturing_order_id', manufacturingOrderId)
      .order('created_at', { ascending: true })

    if (error) throw error
    return data
  },

  create: async (processCost: ProcessCostInput) => {
    const supabase = await getClient()
    const total_cost = (processCost.material_cost || 0) + (processCost.labor_cost || 0) + (processCost.overhead_cost || 0);
    const { data, error } = await supabase
      .from('process_costs')
      .insert({ ...processCost, total_cost })
      .select()
      .single();

    if (error) throw error

    // Update manufacturing order total cost
    if (processCost.manufacturing_order_id) {
      await processCostService.updateOrderTotalCost(processCost.manufacturing_order_id)
    }

    return data
  },

  updateOrderTotalCost: async (manufacturingOrderId: string) => {
    const supabase = await getClient()
    const { data: costs } = await supabase
      .from('process_costs')
      .select('total_cost')
      .eq('manufacturing_order_id', manufacturingOrderId)

    const totalCost = costs?.reduce((sum: number, cost: Record<string, unknown>) => sum + ((cost.total_cost as number) || 0), 0) || 0

    await supabase
      .from('manufacturing_orders')
      .update({
        total_cost: totalCost,
        updated_at: new Date().toISOString()
      })
      .eq('id', manufacturingOrderId)
  }
}

// Stock Movements Service
export const stockMovementsService = {
  getAll: async () => {
    const supabase = await getClient()
    // First try to get stock movements with user data
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        *,
        item:products(*),
        user:users(full_name)
      `)
      .order('created_at', { ascending: false })

    // If there's an error related to the user not being found, try without user data
    if (error?.message.includes('404')) {
      console.warn('User not found for stock movements, fetching without user data')
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('stock_movements')
        .select(`
          *,
          item:products(*)
        `)
        .order('created_at', { ascending: false })

      if (fallbackError) throw fallbackError
      return fallbackData
    }

    if (error) throw error
    return data
  },

  getByItemId: async (itemId: string) => {
    const supabase = await getClient()
    // First try to get stock movements with user data
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        *,
        item:products(*),
        user:users(full_name)
      `)
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })

    // If there's an error related to the user not being found, try without user data
    if (error?.message.includes('404')) {
      console.warn('User not found for stock movements, fetching without user data for item:', itemId)
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('stock_movements')
        .select(`
          *,
          item:products(*)
        `)
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })

      if (fallbackError) throw fallbackError
      return fallbackData
    }

    if (error) throw error
    return data
  }
}

// Purchase Orders Service
export const purchaseOrdersService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        vendor:vendors(*),
        purchase_order_lines(
          *,
          product:products(*)
        )
      `)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  create: async (order: PurchaseOrderInput, items: PurchaseOrderItemInput[]) => {
    const supabase = await getClient()
    const { data: orderData, error: orderError } = await supabase
      .from('purchase_orders')
      .insert(order)
      .select()
      .single()

    if (orderError) throw orderError

    const orderItems = items.map(item => ({
      ...item,
      purchase_order_id: orderData.id,
      total_price: item.quantity * (item.unit_price || 0)
    }))

    const { error: itemsError } = await supabase
      .from('purchase_order_lines')
      .insert(orderItems)

    if (itemsError) throw itemsError

    const totalAmount = orderItems.reduce((sum: number, item: Record<string, unknown>) => sum + ((item.total_price as number) || 0), 0)

    // Update total amount
    const { data, error: updateError } = await supabase
      .from('purchase_orders')
      .update({ total_amount: totalAmount })
      .eq('id', orderData.id)
      .select(`
        *,
        vendor:vendors(*),
        purchase_order_lines(
          *,
          product:products(*)
        )
      `)
      .single()

    if (updateError) throw updateError

    if (updateError) throw updateError
    return data
  }
}

// Sales Orders Service
export const salesOrdersService = {
  getAll: async () => {
    const supabase = await getClient();

    try {
      const { data, error } = await fetchSalesOrdersWithRelations(supabase);

      if (!error && data) {
        return data;
      }

      if (isSalesRelationshipNotFound(error)) {
        const orders = await fetchSalesOrdersSimple(supabase);
        return await attachCustomersToOrders(supabase, orders);
      }

      if (isSalesTableNotFound(error)) {
        return await fetchSalesInvoicesAsFallback(supabase);
      }

      if (error) {
        console.warn('Error fetching sales orders with user data, retrying without it.', (error as { message?: string }).message);
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('sales_orders')
          .select(`
            *,
            customer:customers(*),
            sales_order_items(
              *,
              item:products(*)
            )
          `)
          .order('created_at', { ascending: false });

        if (fallbackError) {
          if (isSalesTableNotFound(fallbackError)) {
            console.warn('sales_orders table not found, returning empty array');
            return [];
          }
          throw fallbackError;
        }
        return fallbackData || [];
      }

      return data || [];
    } catch (error: unknown) {
      if (isSalesTableNotFound(error)) {
        return await fetchSalesInvoicesAsFallback(supabase);
      }
      throw error;
    }
  },

  create: async (order: SalesOrderInput, items: SalesOrderItemInput[]) => {
    const supabase = await getClient();
    const { data: orderData, error: orderError } = await supabase
      .from('sales_orders')
      .insert(order)
      .select()
      .single();

    if (orderError) throw orderError;

    const orderItems = items.map(item => ({
      ...item,
      sales_order_id: orderData.id,
      total_price: item.quantity * (item.unit_price || 0)
    }));

    const { error: itemsError } = await supabase
      .from('sales_order_items')
      .insert(orderItems);

    if (itemsError) throw itemsError;

    const totalAmount = calculateTotalAmount(orderItems);
    return await updateSalesOrderWithFallback(supabase, orderData.id, totalAmount);
  }
}

// ============================================
// NEW PROCUREMENT & SALES SERVICES
// ============================================

// Vendors Service (new procurement system)
export const vendorsService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .order('code')

    if (error) throw error
    return data
  }
}

// Purchase Orders Service (new system)
export const newPurchaseOrdersService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        vendor:vendors(*),
        purchase_order_lines(
          *,
          product:products(*)
        )
      `)
      .order('so_date', { ascending: false })

    if (error) throw error
    return data
  },

  getById: async (id: string) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        vendor:vendors(*),
        purchase_order_lines(
          *,
          product:products(*)
        )
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  }
}

// Goods Receipts Service
export const goodsReceiptsService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('goods_receipts')
      .select(`
        *,
        purchase_order:purchase_orders(
          order_number,
          vendor:vendors(name)
        ),
        goods_receipt_lines(
          *,
          product:products(*)
        )
      `)
      .order('receipt_date', { ascending: false })

    if (error) throw error
    return data
  }
}

// Sales Invoices Service (new system)
export const newSalesInvoicesService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('sales_invoices')
      .select(`
        *,
        customer:customers(*),
        sales_invoice_lines(
          *,
          product:products(*)
        )
      `)
      .order('invoice_date', { ascending: false })

    if (error) throw error
    return data
  },

  getById: async (id: string) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('sales_invoices')
      .select(`
        *,
        customer:customers(*),
        sales_invoice_lines(
          *,
          product:products(*)
        )
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  }
}

// Delivery Notes Service
export const deliveryNotesService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('delivery_notes')
      .select(`
        *,
        sales_invoice:sales_invoices(
          invoice_number,
          customer:customers(name)
        ),
        delivery_note_lines(
          *,
          product:products(*)
        )
      `)
      .order('delivery_date', { ascending: false })

    if (error) throw error
    return data
  }
}

// Journal Entries Service
export const journalEntriesService = {
  getAll: async () => {
    return PerformanceMonitor.measure('Journal Entries Service List', async () => {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('gl_entries')
        .select(`
          *,
          gl_entry_lines(*)
        `)
        .order('entry_date', { ascending: false })

      if (error) throw error
      return data
    })
  },

  getById: async (id: string) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('gl_entries')
      .select(`
        *,
        gl_entry_lines(*)
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  }
}

// Trial Balance Service
export const trialBalanceService = {
  get: async (startDate?: string, endDate?: string) => {
    return PerformanceMonitor.measure('Trial Balance Service Get', async () => {
      const supabase = await getClient();
      const orgId = await getTenantId();

      // Try using the optimized view first
      const viewResult = await fetchTrialBalanceFromView(supabase, orgId);
      if (viewResult) {
        return viewResult;
      }

      // Fallback: Manual calculation
      const entries = await fetchPostedEntries(supabase, startDate, endDate);
      if (entries.length === 0) {
        return [];
      }

      const entryIds = entries.map(e => e.id);
      const lines = await fetchEntryLines(supabase, entryIds);
      if (lines.length === 0) {
        return [];
      }

      const accountCodes = [...new Set(lines.map(line => line.account_code))];
      const accountNamesMap = await fetchAccountNames(supabase, accountCodes);

      return calculateTrialBalanceTotals(lines, accountNamesMap);
    });
  }
}

// Real-time subscriptions
export const subscribeToItems = (callback: (items: Item[]) => void) => {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase client not initialized')
  return supabase
    .channel('products_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
      itemsService.getAll().then(callback)
    })
    .subscribe()
}

export const subscribeToManufacturingOrders = (callback: (orders: Record<string, unknown>[]) => void) => {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase client not initialized')
  return supabase
    .channel('manufacturing_orders_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'manufacturing_orders' }, () => {
      manufacturingService.getAll().then(callback)
    })
    .subscribe()
}

// ===================================================================
// MANUFACTURING STAGES SERVICE
// ===================================================================
export const manufacturingStagesService = {
  getAll: async () => {
    return PerformanceMonitor.measure('Manufacturing Stages List', async () => {
      try {
        const config = await getConfig()
        const tenantId = await getTenantId()
        const supabase = await getClient()

        let query = supabase
          .from('manufacturing_stages')
          .select('*, work_centers(*), gl_accounts:wip_gl_account_id(*)')
          .order('order_sequence', { ascending: true })

        // Use tenantId or fallback to config.ORG_ID (with null check)
        const orgId = tenantId || (config?.ORG_ID)
        if (orgId) {
          query = query.eq('org_id', orgId)
        }

        const { data, error } = await query

        if (error) throw error
        return data || []
      } catch (error: unknown) {
        console.error('❌ Error fetching manufacturing stages:', error)
        throw error
      }
    })
  },

  getById: async (id: string) => {
    try {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('manufacturing_stages')
        .select('*, work_centers(*), gl_accounts:wip_gl_account_id(*)')
        .eq('id', id)
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error fetching manufacturing stage:', error)
      throw error
    }
  },

  create: async (stage: Record<string, unknown>) => {
    try {
      const config = await getConfig()
      const tenantId = await getTenantId()
      const supabase = await getClient()

      // Use tenantId or fallback to config.ORG_ID (with null check)
      const orgId = tenantId || (config?.ORG_ID)

      const { data, error } = await supabase
        .from('manufacturing_stages')
        .insert({
          ...stage,
          org_id: orgId
        })
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('❌ Error creating manufacturing stage:', error)
      throw error
    }
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    try {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('manufacturing_stages')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error updating manufacturing stage:', error)
      throw error
    }
  },

  delete: async (id: string) => {
    try {
      const supabase = await getClient()
      const { error } = await supabase
        .from('manufacturing_stages')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    } catch (error: unknown) {
      console.error('Error deleting manufacturing stage:', error)
      throw error
    }
  }
}

// ===================================================================
// STAGE WIP LOG SERVICE
// ===================================================================
export const stageWipLogService = {
  getAll: async (filters?: {
    moId?: string
    stageId?: string
    periodStart?: string
    periodEnd?: string
    isClosed?: boolean
  }) => {
    return PerformanceMonitor.measure('Stage WIP Log List', async () => {
      try {
        const tenantId = await getTenantId();
        const supabase = await getClient();

        let query = supabase
          .from('stage_wip_log')
          .select('*, manufacturing_stages(*), manufacturing_orders(*)')
          .order('period_start', { ascending: false })
          .order('created_at', { ascending: false });

        if (tenantId) {
          query = query.eq('org_id', tenantId);
        }

        if (filters?.moId) {
          query = query.eq('mo_id', filters.moId);
        }

        if (filters?.stageId) {
          query = query.eq('stage_id', filters.stageId);
        }

        if (filters?.periodStart) {
          query = query.gte('period_start', filters.periodStart);
        }

        if (filters?.periodEnd) {
          query = query.lte('period_end', filters.periodEnd);
        }

        if (filters?.isClosed !== undefined) {
          query = query.eq('is_closed', filters.isClosed);
        }

        const { data, error } = await query;

        if (error) throw error;
        return data || [];
      } catch (error: unknown) {
        console.error('Error fetching stage WIP log:', error);
        throw error;
      }
    });
  },

  getById: async (id: string) => {
    try {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('stage_wip_log')
        .select('*, manufacturing_stages(*), manufacturing_orders(*)')
        .eq('id', id)
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error fetching stage WIP log:', error)
      throw error
    }
  },

  create: async (wipLog: Record<string, unknown>) => {
    try {
      const config = await getConfig()
      const tenantId = await getTenantId()
      const supabase = await getClient()

      const { data, error } = await supabase
        .from('stage_wip_log')
        .insert({
          ...wipLog,
          org_id: tenantId || (config?.ORG_ID)
        })
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error creating stage WIP log:', error)
      throw error
    }
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    try {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('stage_wip_log')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error updating stage WIP log:', error)
      throw error
    }
  },

  closePeriod: async (id: string, closedBy?: string) => {
    try {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('stage_wip_log')
        .update({
          is_closed: true,
          closed_at: new Date().toISOString(),
          closed_by: closedBy,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error closing period:', error)
      throw error
    }
  },

  delete: async (id: string) => {
    try {
      const supabase = await getClient()
      const { error } = await supabase
        .from('stage_wip_log')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true }
    } catch (error: unknown) {
      console.error('Error deleting stage WIP log:', error)
      throw error
    }
  }
}

// ===================================================================
// STANDARD COSTS SERVICE
// ===================================================================
export const standardCostsService = {
  getAll: async (filters?: {
    productId?: string
    stageId?: string
    isActive?: boolean
  }) => {
    return PerformanceMonitor.measure('Standard Costs List', async () => {
      try {
        const tenantId = await getTenantId()
        const supabase = await getClient()

        let query = supabase
          .from('standard_costs')
          .select('*, products(*), manufacturing_stages(*)')
          .order('effective_from', { ascending: false })

        if (tenantId) {
          query = query.eq('org_id', tenantId)
        }

        if (filters?.productId) {
          query = query.eq('product_id', filters.productId)
        }

        if (filters?.stageId) {
          query = query.eq('stage_id', filters.stageId)
        }

        if (filters?.isActive !== undefined) {
          query = query.eq('is_active', filters.isActive)
        }

        const { data, error } = await query

        if (error) throw error
        return data || []
      } catch (error: unknown) {
        console.error('Error fetching standard costs:', error)
        throw error
      }
    })
  },

  getById: async (id: string) => {
    try {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('standard_costs')
        .select('*, products(*), manufacturing_stages(*)')
        .eq('id', id)
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error fetching standard cost:', error)
      throw error
    }
  },

  getActive: async (productId: string, stageId: string, date?: string) => {
    try {
      const config = await getConfig()
      const tenantId = await getTenantId()
      const supabase = await getClient()
      const checkDate = date || new Date().toISOString().split('T')[0]

      // Use tenantId or fallback to config.ORG_ID (with null check)
      const orgId = tenantId || (config?.ORG_ID)
      if (!orgId) {
        throw new Error('Organization ID is required but not available')
      }

      const { data, error } = await supabase
        .from('standard_costs')
        .select('*, products(*), manufacturing_stages(*)')
        .eq('org_id', orgId)
        .eq('product_id', productId)
        .eq('stage_id', stageId)
        .eq('is_active', true)
        .lte('effective_from', checkDate)
        .or(`effective_to.is.null,effective_to.gte.${checkDate}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .single()

      if (error && error.code !== 'PGRST116') throw error // PGRST116 = no rows returned
      return data || null
    } catch (error: unknown) {
      console.error('Error fetching active standard cost:', error)
      throw error
    }
  },

  create: async (standardCost: Record<string, unknown>) => {
    try {
      const config = await getConfig()
      const tenantId = await getTenantId()
      const supabase = await getClient()

      const { data, error } = await supabase
        .from('standard_costs')
        .insert({
          ...standardCost,
          org_id: tenantId || (config?.ORG_ID)
        })
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error creating standard cost:', error)
      throw error
    }
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    try {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('standard_costs')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error updating standard cost:', error)
      throw error
    }
  },

  approve: async (id: string, approvedBy: string) => {
    try {
      const supabase = await getClient()
      const { data, error } = await supabase
        .from('standard_costs')
        .update({
          approved_by: approvedBy,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error: unknown) {
      console.error('Error approving standard cost:', error)
      throw error
    }
  }
}
