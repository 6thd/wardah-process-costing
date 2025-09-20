import { getSupabase } from '../lib/supabase'
import { getTenantId } from '../lib/supabase'
import { getTableName } from '../lib/config'
import type { 
  Item, Category, Supplier, Customer, ManufacturingOrder, 
  ProcessCost, PurchaseOrder, SalesOrder,
  PurchaseOrderItem, SalesOrderItem 
} from '../lib/supabase'

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
  const client = await getSupabase()
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

  create: async (category: Omit<Category, 'id' | 'created_at' | 'updated_at'>) => {
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

// Items Service (Enhanced)
export const itemsService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('items')
      .select(`
        *,
        category:categories(*)
      `)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  getLowStock: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('items')
      .select(`
        *,
        category:categories(*)
      `)
      .filter('stock_quantity', 'lte', 'minimum_stock')
    
    if (error) throw error
    return data
  },

  getById: async (id: string) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('items')
      .select(`
        *,
        category:categories(*)
      `)
      .eq('id', id)
      .single()
    
    if (error) throw error
    return data
  },

  create: async (item: Omit<Item, 'id' | 'created_at' | 'updated_at'>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('items')
      .insert(item)
      .select(`
        *,
        category:categories(*)
      `)
      .single()
    
    if (error) throw error
    return data
  },

  update: async (id: string, item: Partial<Item>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('items')
      .update({ ...item, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(`
        *,
        category:categories(*)
      `)
      .single()
    
    if (error) throw error
    return data
  },

  updateStock: async (itemId: string, quantity: number, movementType: 'in' | 'out' | 'adjustment', userId: string, notes?: string) => {
    const supabase = await getClient()
    const { data: item } = await supabase
      .from('items')
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
      .from('items')
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
      .from('items')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  }
}

// Suppliers Service
export const suppliersService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name')
    
    if (error) throw error
    return data
  },

  create: async (supplier: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('suppliers')
      .insert(supplier)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  update: async (id: string, supplier: Partial<Supplier>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('suppliers')
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

  create: async (customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>) => {
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
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .select(`
        *,
        item:items(*),
        user:users(full_name),
        process_costs(*)
      `)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  getById: async (id: string) => {
    const supabase = await getClient()
    // First try to get the manufacturing order with user data
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .select(`
        *,
        item:items(*),
        user:users(full_name),
        process_costs(*)
      `)
      .eq('id', id)
      .single()
    
    // If there's an error related to the user not being found, try without user data
    if (error && error.message.includes('404')) {
      console.warn('User not found for manufacturing order, fetching without user data:', id)
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('manufacturing_orders')
        .select(`
          *,
          item:items(*),
          process_costs(*)
        `)
        .eq('id', id)
        .single()
      
      if (fallbackError) throw fallbackError
      return fallbackData
    }
    
    if (error) throw error
    return data
  },

  create: async (order: Omit<ManufacturingOrder, 'id' | 'created_at' | 'updated_at'>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .insert(order)
      .select(`
        *,
        item:items(*)
      `)
      .single()
    
    if (error) throw error
    return data
  },

  updateStatus: async (id: string, status: ManufacturingOrder['status']) => {
    const supabase = await getClient()
    const updateData: any = { 
      status, 
      updated_at: new Date().toISOString()
    }
    
    if (status === 'completed') {
      updateData.end_date = new Date().toISOString()
    }

    // First try to update with user data
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        item:items(*),
        user:users(full_name)
      `)
      .single()
    
    // If there's an error related to the user not being found, try without user data
    if (error && error.message.includes('404')) {
      console.warn('User not found for manufacturing order, updating without user data:', id)
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('manufacturing_orders')
        .update(updateData)
        .eq('id', id)
        .select(`
          *,
          item:items(*)
        `)
        .single()
      
      if (fallbackError) throw fallbackError
      return fallbackData
    }
    
    if (error) throw error
    return data
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

  create: async (processCost: Omit<ProcessCost, 'id' | 'created_at'>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('process_costs')
      .insert({
        ...processCost,
        total_cost: processCost.material_cost + processCost.labor_cost + processCost.overhead_cost
      })
      .select()
      .single()
    
    if (error) throw error

    // Update manufacturing order total cost
    await processCostService.updateOrderTotalCost(processCost.manufacturing_order_id)
    
    return data
  },

  updateOrderTotalCost: async (manufacturingOrderId: string) => {
    const supabase = await getClient()
    const { data: costs } = await supabase
      .from('process_costs')
      .select('total_cost')
      .eq('manufacturing_order_id', manufacturingOrderId)

    const totalCost = costs?.reduce((sum: number, cost: any) => sum + cost.total_cost, 0) || 0

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
        item:items(*),
        user:users(full_name)
      `)
      .order('created_at', { ascending: false })
    
    // If there's an error related to the user not being found, try without user data
    if (error && error.message.includes('404')) {
      console.warn('User not found for stock movements, fetching without user data')
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('stock_movements')
        .select(`
          *,
          item:items(*)
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
        item:items(*),
        user:users(full_name)
      `)
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
    
    // If there's an error related to the user not being found, try without user data
    if (error && error.message.includes('404')) {
      console.warn('User not found for stock movements, fetching without user data for item:', itemId)
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('stock_movements')
        .select(`
          *,
          item:items(*)
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
        supplier:suppliers(*),
        user:users(full_name),
        purchase_order_items(
          *,
          item:items(*)
        )
      `)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  create: async (order: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>, items: Omit<PurchaseOrderItem, 'id' | 'purchase_order_id' | 'created_at'>[]) => {
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
      total_price: item.quantity * item.unit_price
    }))

    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(orderItems)

    if (itemsError) throw itemsError

    const totalAmount = orderItems.reduce((sum: number, item: any) => sum + item.total_price, 0)
    
    // First try to update with user data
    const { data, error: updateError } = await supabase
      .from('purchase_orders')
      .update({ total_amount: totalAmount })
      .eq('id', orderData.id)
      .select(`
        *,
        supplier:suppliers(*),
        user:users(full_name),
        purchase_order_items(
          *,
          item:items(*)
        )
      `)
      .single()
    
    // If there's an error related to the user not being found, try without user data
    if (updateError && updateError.message.includes('404')) {
      console.warn('User not found for purchase order, updating without user data:', orderData.id)
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('purchase_orders')
        .update({ total_amount: totalAmount })
        .eq('id', orderData.id)
        .select(`
          *,
          supplier:suppliers(*),
          purchase_order_items(
            *,
            item:items(*)
          )
        `)
        .single()
      
      if (fallbackError) throw fallbackError
      return fallbackData
    }
    
    if (updateError) throw updateError
    return data
  }
}

// Sales Orders Service
export const salesOrdersService = {
  getAll: async () => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('sales_orders')
      .select(`
        *,
        customer:customers(*),
        user:users(full_name),
        sales_order_items(
          *,
          item:items(*)
        )
      `)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  create: async (order: Omit<SalesOrder, 'id' | 'created_at' | 'updated_at'>, items: Omit<SalesOrderItem, 'id' | 'sales_order_id' | 'created_at'>[]) => {
    const supabase = await getClient()
    const { data: orderData, error: orderError } = await supabase
      .from('sales_orders')
      .insert(order)
      .select()
      .single()

    if (orderError) throw orderError

    const orderItems = items.map(item => ({
      ...item,
      sales_order_id: orderData.id,
      total_price: item.quantity * item.unit_price
    }))

    const { error: itemsError } = await supabase
      .from('sales_order_items')
      .insert(orderItems)

    if (itemsError) throw itemsError

    const totalAmount = orderItems.reduce((sum: number, item: any) => sum + item.total_price, 0)
    
    // First try to update with user data
    const { data, error: updateError } = await supabase
      .from('sales_orders')
      .update({ total_amount: totalAmount })
      .eq('id', orderData.id)
      .select(`
        *,
        customer:customers(*),
        user:users(full_name),
        sales_order_items(
          *,
          item:items(*)
        )
      `)
      .single()
    
    // If there's an error related to the user not being found, try without user data
    if (updateError && updateError.message.includes('404')) {
      console.warn('User not found for sales order, updating without user data:', orderData.id)
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('sales_orders')
        .update({ total_amount: totalAmount })
        .eq('id', orderData.id)
        .select(`
          *,
          customer:customers(*),
          sales_order_items(
            *,
            item:items(*)
          )
        `)
        .single()
      
      if (fallbackError) throw fallbackError
      return fallbackData
    }
    
    if (updateError) throw updateError
    return data
  }
}

// Real-time subscriptions
export const subscribeToItems = (callback: (items: Item[]) => void) => {
  return getSupabase().then(supabase => {
    if (!supabase) throw new Error('Supabase client not initialized')
    return supabase
      .channel('items_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
        itemsService.getAll().then(callback)
      })
      .subscribe()
  })
}

export const subscribeToManufacturingOrders = (callback: (orders: any[]) => void) => {
  return getSupabase().then(supabase => {
    if (!supabase) throw new Error('Supabase client not initialized')
    return supabase
      .channel('manufacturing_orders_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manufacturing_orders' }, () => {
        manufacturingService.getAll().then(callback)
      })
      .subscribe()
  })
}