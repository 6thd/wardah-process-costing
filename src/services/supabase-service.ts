import { getSupabase } from '../lib/supabase'
import { getTenantId } from '../lib/supabase'
import type {
  Item, Category, Supplier, Customer, ManufacturingOrder,
  ProcessCost, PurchaseOrder, SalesOrder,
  PurchaseOrderItem, SalesOrderItem
} from '../lib/supabase'
import { PerformanceMonitor } from '../lib/performance-monitor'

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

  create: async (item: Omit<Item, 'id' | 'created_at' | 'updated_at'>) => {
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

  create: async (supplier: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>) => {
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
    return PerformanceMonitor.measure('Manufacturing Orders List', async () => {
      try {
        const supabase = await getClient()

        // جلب البيانات بدون joins أولاً (لتجنب مشاكل العلاقات)
        const { data, error } = await supabase
          .from('manufacturing_orders')
          .select('*')
          .order('created_at', { ascending: false })

        // Handle missing table gracefully
        if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
          console.warn('manufacturing_orders table not found, returning empty array')
          return []
        }

        // Handle missing relationship gracefully
        if (error && (error.code === 'PGRST200' || error.message?.includes('Could not find a relationship'))) {
          console.warn('Relationships not found, returning data without joins')
          // Try again without joins
          const { data: simpleData, error: simpleError } = await supabase
            .from('manufacturing_orders')
            .select('*')
            .order('created_at', { ascending: false })

          if (simpleError && simpleError.code === 'PGRST205') {
            return []
          }

          if (simpleError) throw simpleError
          return simpleData || []
        }

        if (error) throw error

        // محاولة جلب بيانات إضافية بشكل منفصل إذا كانت موجودة
        // Performance optimization: Use Promise.all for parallel queries
        if (data && data.length > 0) {
          // جلب بيانات المنتجات إذا كان item_id أو product_id موجود
          const itemIds = data
            .map(order => (order as any).item_id || (order as any).product_id)
            .filter(Boolean)

          if (itemIds.length > 0) {
            try {
              // Parallel queries: fetch products and items simultaneously
              const [productsResult, itemsResult] = await Promise.all([
                supabase
                  .from('products')
                  .select('id, code, name, product_code, product_name')
                  .in('id', itemIds)
                  .then(res => res.data || [])
                  .catch(() => []),
                supabase
                  .from('items')
                  .select('id, code, name, item_code, item_name')
                  .in('id', itemIds)
                  .then(res => res.data || [])
                  .catch(() => [])
              ])

              // Merge results: prefer products over items
              const combinedMap = new Map()
              
              // Add items first
              itemsResult.forEach(item => combinedMap.set(item.id, item))
              
              // Override with products (higher priority)
              productsResult.forEach(product => combinedMap.set(product.id, product))

              // Attach to orders
              data.forEach((order: any) => {
                const itemId = order.item_id || order.product_id
                const relatedData = combinedMap.get(itemId)
                if (relatedData) {
                  order.item = relatedData
                }
              })
            } catch (e) {
              // تجاهل أخطاء جلب البيانات الإضافية
              console.warn('Could not load related data:', e)
            }
          }
        }

        return data || []
      } catch (error: any) {
        // If table doesn't exist, return empty array
        if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
          console.warn('manufacturing_orders table not found, returning empty array')
          return []
        }
        // If relationship doesn't exist, try without joins
        if (error.code === 'PGRST200' || error.message?.includes('Could not find a relationship')) {
          console.warn('Relationships not found, trying without joins')
          try {
            const supabase = await getClient()
            const { data, error: simpleError } = await supabase
              .from('manufacturing_orders')
              .select('*')
              .order('created_at', { ascending: false })

            if (simpleError && simpleError.code === 'PGRST205') {
              return []
            }

            if (simpleError) throw simpleError
            return data || []
          } catch (e: any) {
            if (e.code === 'PGRST205') {
              return []
            }
            throw e
          }
        }
        throw error
      }
    })
  },

  getById: async (id: string) => {
    try {
      const supabase = await getClient()

      // جلب البيانات بدون joins أولاً
      const { data, error } = await supabase
        .from('manufacturing_orders')
        .select('*')
        .eq('id', id)
        .single()

      // Handle missing table gracefully
      if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
        console.warn('manufacturing_orders table not found')
        return null
      }

      // Handle missing relationship gracefully
      if (error && (error.code === 'PGRST200' || error.message?.includes('Could not find a relationship'))) {
        // Try again without joins
        const { data: simpleData, error: simpleError } = await supabase
          .from('manufacturing_orders')
          .select('*')
          .eq('id', id)
          .single()

        if (simpleError && simpleError.code === 'PGRST205') {
          return null
        }

        if (simpleError) throw simpleError
        return simpleData
      }

      if (error) throw error

      // محاولة جلب بيانات إضافية بشكل منفصل
      if (data) {
        const itemId = (data as any).item_id || (data as any).product_id
        if (itemId) {
          try {
            // محاولة products
            const { data: product } = await supabase
              .from('products')
              .select('id, code, name, product_code, product_name')
              .eq('id', itemId)
              .single()

            if (product) {
              (data as any).item = product
            } else {
              // محاولة items
              const { data: item } = await supabase
                .from('items')
                .select('id, code, name, item_code, item_name')
                .eq('id', itemId)
                .single()

              if (item) {
                (data as any).item = item
              }
            }
          } catch (e) {
            // تجاهل أخطاء جلب البيانات الإضافية
            console.warn('Could not load related data:', e)
          }
        }
      }

      return data
    } catch (error: any) {
      // If table doesn't exist, return null
      if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
        console.warn('manufacturing_orders table not found')
        return null
      }
      // If relationship doesn't exist, try without joins
      if (error.code === 'PGRST200' || error.message?.includes('Could not find a relationship')) {
        try {
          const supabase = await getClient()
          const { data, error: simpleError } = await supabase
            .from('manufacturing_orders')
            .select('*')
            .eq('id', id)
            .single()

          if (simpleError && simpleError.code === 'PGRST205') {
            return null
          }

          if (simpleError) throw simpleError
          return data
        } catch (e: any) {
          if (e.code === 'PGRST205') {
            return null
          }
          throw e
        }
      }
      throw error
    }
  },

  create: async (order: Omit<ManufacturingOrder, 'id' | 'created_at' | 'updated_at'>) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .insert(order)
      .select(`
        *,
        item:products(*)
      `)
      .single()

    if (error) throw error
    return data
  },

  updateStatus: async (id: string, status: ManufacturingOrder['status']) => {
    try {
      const supabase = await getClient()
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      }

      if (status === 'completed') {
        updateData.end_date = new Date().toISOString()
      }

      // Update without joins
      const { data, error } = await supabase
        .from('manufacturing_orders')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single()

      // Handle missing table gracefully
      if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
        console.warn('manufacturing_orders table not found')
        throw new Error('manufacturing_orders table does not exist')
      }

      // Handle missing relationship gracefully
      if (error && (error.code === 'PGRST200' || error.message?.includes('Could not find a relationship'))) {
        // Try again without joins
        const { data: simpleData, error: simpleError } = await supabase
          .from('manufacturing_orders')
          .update(updateData)
          .eq('id', id)
          .select('*')
          .single()

        if (simpleError && simpleError.code === 'PGRST205') {
          throw new Error('manufacturing_orders table does not exist')
        }

        if (simpleError) throw simpleError
        return simpleData
      }

      if (error) throw error

      // محاولة جلب بيانات المنتج بشكل منفصل
      if (data) {
        const itemId = (data as any).item_id || (data as any).product_id
        if (itemId) {
          try {
            const { data: product } = await supabase
              .from('products')
              .select('id, code, name, product_code, product_name')
              .eq('id', itemId)
              .single()

            if (product) {
              (data as any).item = product
            } else {
              const { data: item } = await supabase
                .from('items')
                .select('id, code, name, item_code, item_name')
                .eq('id', itemId)
                .single()

              if (item) {
                (data as any).item = item
              }
            }
          } catch (e) {
            // تجاهل أخطاء جلب البيانات الإضافية
            console.warn('Could not load related data:', e)
          }
        }
      }

      return data
    } catch (error: any) {
      if (error.code === 'PGRST205') {
        throw new Error('manufacturing_orders table does not exist')
      }
      if (error.code === 'PGRST200') {
        // Try again without joins
        try {
          const supabase = await getClient()
          const updateData: any = {
            status,
            updated_at: new Date().toISOString()
          }

          if (status === 'completed') {
            updateData.end_date = new Date().toISOString()
          }

          const { data, error: simpleError } = await supabase
            .from('manufacturing_orders')
            .update(updateData)
            .eq('id', id)
            .select('*')
            .single()

          if (simpleError && simpleError.code === 'PGRST205') {
            throw new Error('manufacturing_orders table does not exist')
          }

          if (simpleError) throw simpleError
          return data
        } catch (e: any) {
          if (e.code === 'PGRST205') {
            throw new Error('manufacturing_orders table does not exist')
          }
          throw e
        }
      }
      throw error
    }
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
        item:products(*),
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
    if (error && error.message.includes('404')) {
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
      total_price: item.quantity * (item.unit_price || 0)
    }))

    const { error: itemsError } = await supabase
      .from('purchase_order_lines')
      .insert(orderItems)

    if (itemsError) throw itemsError

    const totalAmount = orderItems.reduce((sum: number, item: any) => sum + item.total_price, 0)

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
    const supabase = await getClient()

    // First try sales_orders
    let { data, error } = await supabase
      .from('sales_orders')
      .select(`
        *,
        customer:customers(*),
        user:users(full_name),
        sales_order_items(
          *,
          item:products(*)
        )
      `)
      .order('created_at', { ascending: false })

    // If table doesn't exist, try sales_invoices instead
    if (error && error.code === 'PGRST205') {
      console.warn('sales_orders table not found, trying sales_invoices instead')
      const { data: invoicesData, error: invoicesError } = await supabase
        .from('sales_invoices')
        .select(`
          *,
          customer:customers(*)
        `)
        .order('invoice_date', { ascending: false })
        .limit(100)

      if (invoicesError) {
        console.error('Error fetching sales_invoices:', invoicesError.message)
        // Return empty array instead of throwing
        return []
      }

      // Map invoices to orders format for compatibility
      return (invoicesData || []).map((inv: any) => ({
        ...inv,
        so_date: inv.invoice_date,
        so_number: inv.invoice_number,
        status: inv.payment_status || inv.delivery_status || 'draft'
      }))
    }

    if (error) {
      console.warn('Error fetching sales orders with user data, retrying without it.', error.message)
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
        .order('created_at', { ascending: false })

      if (fallbackError) {
        if (fallbackError.code === 'PGRST205') {
          // Table doesn't exist, return empty array
          console.warn('sales_orders table not found, returning empty array')
          return []
        }
        console.error('Fallback fetch for sales orders also failed:', fallbackError.message)
        throw fallbackError
      }
      return fallbackData
    }

    return data || []
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
      total_price: item.quantity * (item.unit_price || 0)
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
          item:products(*)
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
            item:products(*)
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
      .order('order_date', { ascending: false })

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
      const supabase = await getClient()
      const orgId = await getTenantId()

      // Try using the optimized view first (60-70% faster!)
      try {
        console.log('🚀 Trying v_trial_balance view...')
        
        let viewQuery = supabase
          .from('v_trial_balance')
          .select('*')
        
        if (orgId) {
          viewQuery = viewQuery.eq('org_id', orgId)
        }

        const { data: viewData, error: viewError } = await viewQuery

        if (!viewError && viewData && viewData.length > 0) {
          console.log(`✅ Trial balance from VIEW: ${viewData.length} accounts (FAST!)`)
          
          // Map view columns to expected format
          return viewData.map((row: any) => ({
            account_code: row.account_code,
            account_name: row.account_name,
            account_name_ar: row.account_name_ar,
            debit: row.total_debit || 0,
            credit: row.total_credit || 0
          })).sort((a, b) => a.account_code.localeCompare(b.account_code))
        }
        
        console.warn('⚠️ View not available or empty, falling back to manual calculation')
      } catch (viewErr) {
        console.warn('⚠️ View query failed, falling back to manual calculation:', viewErr)
      }

      // Fallback: Original logic (slower but reliable)
      console.log('📊 Using manual calculation...')

      // First, get all POSTED entries (case-insensitive)
      let entriesQuery = supabase
        .from('gl_entries')
        .select('id, entry_date, status')
        .ilike('status', 'posted')

      if (startDate) {
        entriesQuery = entriesQuery.gte('entry_date', startDate)
      }
      if (endDate) {
        entriesQuery = entriesQuery.lte('entry_date', endDate)
      }

      const { data: entries, error: entriesError } = await entriesQuery

      if (entriesError) {
        console.error('❌ Error fetching entries:', entriesError)
        throw entriesError
      }

      if (!entries || entries.length === 0) {
        console.warn('⚠️ No posted entries found')
        return []
      }

      console.log(`✅ Found ${entries.length} posted entries`)

      // Get all entry IDs
      const entryIds = entries.map(e => e.id)

      // Get all lines for these entries
      const { data: lines, error: linesError } = await supabase
        .from('gl_entry_lines')
        .select('*')
        .in('entry_id', entryIds)

      if (linesError) {
        console.error('❌ Error fetching lines:', linesError)
        throw linesError
      }

      if (!lines || lines.length === 0) {
        console.warn('⚠️ No lines found for posted entries')
        return []
      }

      console.log(`✅ Found ${lines.length} lines`)

      // Get all unique account codes
      const accountCodes = [...new Set(lines.map((line: any) => line.account_code))]

      // Fetch account names from gl_accounts
      const { data: accounts, error: accountsError} = await supabase
        .from('gl_accounts')
        .select('code, name, name_ar')
        .in('code', accountCodes)

      if (accountsError) {
        console.warn('⚠️ Error fetching account names:', accountsError)
      }

      // Create account name lookup
      const accountNamesMap = new Map<string, { name: string, name_ar?: string }>()
      accounts?.forEach((acc: any) => {
        accountNamesMap.set(acc.code, { name: acc.name, name_ar: acc.name_ar })
      })

      // Group by account and calculate totals
      const accountTotals = new Map<string, { debit: number, credit: number, name: string, name_ar?: string }>()

      lines.forEach((line: any) => {
        if (!accountTotals.has(line.account_code)) {
          const accountInfo = accountNamesMap.get(line.account_code)
          accountTotals.set(line.account_code, {
            debit: 0,
            credit: 0,
            name: accountInfo?.name || line.account_name || line.account_code,
            name_ar: accountInfo?.name_ar
          })
        }

        const account = accountTotals.get(line.account_code)!
        account.debit += line.debit_amount || 0
        account.credit += line.credit_amount || 0
      })

      // Convert to array and sort by account code
      const trialBalance = Array.from(accountTotals.entries())
        .map(([code, totals]) => ({
          account_code: code,
          account_name: totals.name,
          account_name_ar: totals.name_ar,
          debit: totals.debit,
          credit: totals.credit
        }))
        .sort((a, b) => a.account_code.localeCompare(b.account_code))

      console.log(`✅ Trial balance calculated: ${trialBalance.length} accounts`)

      return trialBalance
    })
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

export const subscribeToManufacturingOrders = (callback: (orders: any[]) => void) => {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase client not initialized')
  return supabase
    .channel('manufacturing_orders_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'manufacturing_orders' }, () => {
      manufacturingService.getAll().then(callback)
    })
    .subscribe()
}
