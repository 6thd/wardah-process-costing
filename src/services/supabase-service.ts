import { supabase } from '../lib/supabase'
import type { 
  Item, Category, Supplier, Customer, ManufacturingOrder, 
  ProcessCost, PurchaseOrder, SalesOrder,
  PurchaseOrderItem, SalesOrderItem 
} from '../lib/supabase'

// Categories Service
export const categoriesService = {
  getAll: async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('name')
    
    if (error) throw error
    return data
  },

  create: async (category: Omit<Category, 'id' | 'created_at' | 'updated_at'>) => {
    const { data, error } = await supabase
      .from('categories')
      .insert(category)
      .select()
      .single()
    
    if (error) throw error
    return data
  }
}

// Items Service (Enhanced)
export const itemsService = {
  getAll: async () => {
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
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name')
    
    if (error) throw error
    return data
  },

  create: async (supplier: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>) => {
    const { data, error } = await supabase
      .from('suppliers')
      .insert(supplier)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  update: async (id: string, supplier: Partial<Supplier>) => {
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
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('name')
    
    if (error) throw error
    return data
  },

  create: async (customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>) => {
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
    
    if (error) throw error
    return data
  },

  create: async (order: Omit<ManufacturingOrder, 'id' | 'created_at' | 'updated_at'>) => {
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .insert(order)
      .select(`
        *,
        item:items(*),
        user:users(full_name)
      `)
      .single()
    
    if (error) throw error
    return data
  },

  updateStatus: async (id: string, status: ManufacturingOrder['status']) => {
    const updateData: any = { 
      status, 
      updated_at: new Date().toISOString()
    }
    
    if (status === 'completed') {
      updateData.end_date = new Date().toISOString()
    }

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
    
    if (error) throw error
    return data
  }
}

// Process Costs Service (Enhanced)
export const processCostService = {
  getByOrderId: async (manufacturingOrderId: string) => {
    const { data, error } = await supabase
      .from('process_costs')
      .select('*')
      .eq('manufacturing_order_id', manufacturingOrderId)
      .order('created_at', { ascending: true })
    
    if (error) throw error
    return data
  },

  create: async (processCost: Omit<ProcessCost, 'id' | 'created_at'>) => {
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
    const { data: costs } = await supabase
      .from('process_costs')
      .select('total_cost')
      .eq('manufacturing_order_id', manufacturingOrderId)

    const totalCost = costs?.reduce((sum, cost) => sum + cost.total_cost, 0) || 0

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
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        *,
        item:items(*),
        user:users(full_name)
      `)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  getByItemId: async (itemId: string) => {
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        *,
        item:items(*),
        user:users(full_name)
      `)
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  }
}

// Purchase Orders Service
export const purchaseOrdersService = {
  getAll: async () => {
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

    const totalAmount = orderItems.reduce((sum, item) => sum + item.total_price, 0)
    
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

    if (updateError) throw updateError
    return data
  }
}

// Sales Orders Service
export const salesOrdersService = {
  getAll: async () => {
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

    const totalAmount = orderItems.reduce((sum, item) => sum + item.total_price, 0)
    
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

    if (updateError) throw updateError
    return data
  }
}

// Real-time subscriptions
export const subscribeToItems = (callback: (items: Item[]) => void) => {
  return supabase
    .channel('items_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
      itemsService.getAll().then(callback)
    })
    .subscribe()
}

export const subscribeToManufacturingOrders = (callback: (orders: any[]) => void) => {
  return supabase
    .channel('manufacturing_orders_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'manufacturing_orders' }, () => {
      manufacturingService.getAll().then(callback)
    })
    .subscribe()
}