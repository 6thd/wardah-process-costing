import { getSupabase } from '../core/supabase.js';
import { loadConfig, table } from '../core/config.js';
import { registerActions } from '../core/actions.js';
import { salesStore } from '../core/store.js';
import { showToast } from '../core/ui-bootstrap.js';

/**
 * Sales Module - Handle customers, sales orders, and COGS calculation
 */
export async function registerSales() {
  console.log('📦 Registering Sales module...');
  
  const cfg = await loadConfig();
  const supabase = await getSupabase();

  // Table mappings
  const T = {
    customers: table(cfg, 'customers'),
    sales_orders: table(cfg, 'sales_orders'),
    sales_order_lines: table(cfg, 'sales_order_lines'),
    stock_moves: table(cfg, 'stock_moves'),
    invoices: table(cfg, 'invoices') || 'invoices',
    items: table(cfg, 'items')
  };

  /**
   * Create new customer
   */
  async function createCustomer(formData) {
    const { name, name_ar, code, contact_person, phone, email, address, credit_limit } = formData;
    
    if (!name || !code) {
      throw new Error('اسم العميل والكود مطلوبان');
    }
    
    salesStore.set({ isLoading: true });
    
    try {
      const customerData = {
        name: name.trim(),
        name_ar: name_ar?.trim() || name.trim(),
        code: code.trim().toUpperCase(),
        contact_person: contact_person?.trim(),
        phone: phone?.trim(),
        email: email?.trim(),
        address: address?.trim(),
        credit_limit: Number(credit_limit || 0),
        current_balance: 0,
        is_active: true,
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.customers)
        .insert([customerData])
        .select()
        .single();
      
      if (error) throw error;
      
      // Update store
      const currentCustomers = salesStore.get().customers || [];
      salesStore.set({ 
        customers: [data, ...currentCustomers]
      });
      
      showToast('تم حفظ العميل بنجاح', 'success');
      return data;
      
    } finally {
      salesStore.set({ isLoading: false });
    }
  }

  /**
   * Update customer
   */
  async function updateCustomer(formData) {
    const { customer_id, name, name_ar, contact_person, phone, email, address, credit_limit, is_active } = formData;
    
    if (!customer_id || !name) {
      throw new Error('معرف العميل والاسم مطلوبان');
    }
    
    try {
      const updateData = {
        name: name.trim(),
        name_ar: name_ar?.trim() || name.trim(),
        contact_person: contact_person?.trim(),
        phone: phone?.trim(),
        email: email?.trim(),
        address: address?.trim(),
        credit_limit: Number(credit_limit || 0),
        is_active: is_active !== undefined ? is_active : true,
        updated_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.customers)
        .update(updateData)
        .eq('id', customer_id)
        .select()
        .single();
      
      if (error) throw error;
      
      showToast('تم تحديث بيانات العميل', 'success');
      return data;
      
    } catch (error) {
      showToast(`خطأ في تحديث العميل: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Create sales order
   */
  async function createSalesOrder(formData) {
    const { customer_id, so_number, order_date, delivery_date, notes } = formData;
    
    if (!customer_id) {
      throw new Error('يجب اختيار العميل');
    }
    
    salesStore.set({ isLoading: true });
    
    try {
      const soData = {
        customer_id: customer_id,
        so_number: so_number || `SO-${Date.now()}`,
        order_date: order_date || new Date().toISOString().split('T')[0],
        delivery_date: delivery_date,
        status: 'draft',
        total_amount: 0,
        total_cost: 0,
        gross_profit: 0,
        notes: notes?.trim(),
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.sales_orders)
        .insert([soData])
        .select(`
          *,
          customer:customers(*)
        `)
        .single();
      
      if (error) throw error;
      
      salesStore.set({ currentSO: data });
      showToast('تم إنشاء أمر البيع', 'success');
      return data;
      
    } finally {
      salesStore.set({ isLoading: false });
    }
  }

  /**
   * Add line item to sales order
   */
  async function addSOLine(formData) {
    const { so_id, item_id, qty, unit_price, discount = 0, notes } = formData;
    
    if (!so_id || !item_id || !qty || !unit_price) {
      throw new Error('جميع البيانات مطلوبة: أمر البيع، الصنف، الكمية، السعر');
    }
    
    try {
      // Get item cost for profit calculation
      const { data: item } = await supabase
        .from(T.items)
        .select('avg_cost')
        .eq('id', item_id)
        .single();
      
      const unitCost = Number(item?.avg_cost || 0);
      const lineQty = Number(qty);
      const linePrice = Number(unit_price);
      const lineDiscount = Number(discount);
      
      const lineTotal = (lineQty * linePrice) - lineDiscount;
      const lineCost = lineQty * unitCost;
      const lineProfit = lineTotal - lineCost;
      
      const lineData = {
        so_id: so_id,
        item_id: item_id,
        qty: lineQty,
        unit_price: linePrice,
        unit_cost: unitCost,
        discount: lineDiscount,
        total_price: lineTotal,
        total_cost: lineCost,
        gross_profit: lineProfit,
        notes: notes?.trim(),
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.sales_order_lines)
        .insert([lineData])
        .select(`
          *,
          item:items(*)
        `)
        .single();
      
      if (error) throw error;
      
      // Update SO totals
      await updateSOTotals(so_id);
      
      showToast('تم إضافة بند البيع', 'success');
      return data;
      
    } catch (error) {
      showToast(`خطأ في إضافة البند: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Update sales order totals
   */
  async function updateSOTotals(soId) {
    const { data: lines } = await supabase
      .from(T.sales_order_lines)
      .select('total_price, total_cost, gross_profit')
      .eq('so_id', soId);
    
    const totals = lines?.reduce((acc, line) => ({
      amount: acc.amount + Number(line.total_price || 0),
      cost: acc.cost + Number(line.total_cost || 0),
      profit: acc.profit + Number(line.gross_profit || 0)
    }), { amount: 0, cost: 0, profit: 0 }) || { amount: 0, cost: 0, profit: 0 };
    
    await supabase
      .from(T.sales_orders)
      .update({ 
        total_amount: totals.amount,
        total_cost: totals.cost,
        gross_profit: totals.profit,
        profit_margin: totals.amount > 0 ? (totals.profit / totals.amount) * 100 : 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', soId);
  }

  /**
   * Confirm sales order
   */
  async function confirmSO(formData) {
    const { so_id } = formData;
    
    if (!so_id) {
      throw new Error('معرف أمر البيع مطلوب');
    }
    
    try {
      const { data, error } = await supabase
        .from(T.sales_orders)
        .update({
          status: 'confirmed',
          confirmed_date: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', so_id)
        .select()
        .single();
      
      if (error) throw error;
      
      showToast('تم تأكيد أمر البيع', 'success');
      return data;
      
    } catch (error) {
      showToast(`خطأ في تأكيد الأمر: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Ship sales order with COGS calculation
   */
  async function shipSalesOrder(formData) {
    const { so_id, location_id = 'MAIN-001', shipping_notes } = formData;
    
    if (!so_id) {
      throw new Error('معرف أمر البيع مطلوب');
    }
    
    salesStore.set({ isLoading: true });
    
    try {
      // Get SO lines
      const { data: soLines } = await supabase
        .from(T.sales_order_lines)
        .select(`
          *,
          item:items(*)
        `)
        .eq('so_id', so_id);
      
      if (!soLines || soLines.length === 0) {
        throw new Error('لا توجد بنود في أمر البيع');
      }
      
      // Create stock movements for each line
      for (const line of soLines) {
        // OUT movement for inventory
        const outMove = {
          item_id: line.item_id,
          qty: Number(line.qty),
          unit_cost: Number(line.unit_cost),
          move_type: 'OUT',
          location_id: location_id,
          source: 'SO',
          source_id: so_id,
          ref_no: so_id,
          notes: `شحن أمر البيع ${so_id} - ${shipping_notes || ''}`.trim(),
          created_at: new Date().toISOString()
        };
        
        const { error: moveError } = await supabase
          .from(T.stock_moves)
          .insert([outMove]);
        
        if (moveError) throw moveError;
        
        // Update item stock
        await updateItemStockForSale(line.item_id, Number(line.qty));
      }
      
      // Update SO status
      const { data, error } = await supabase
        .from(T.sales_orders)
        .update({
          status: 'shipped',
          shipped_date: new Date().toISOString(),
          shipping_notes: shipping_notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', so_id)
        .select()
        .single();
      
      if (error) throw error;
      
      showToast('تم شحن أمر البيع وخصم المخزون', 'success');
      return data;
      
    } finally {
      salesStore.set({ isLoading: false });
    }
  }

  /**
   * Update item stock after sale
   */
  async function updateItemStockForSale(itemId, soldQty) {
    const { data: item } = await supabase
      .from(T.items)
      .select('stock_qty')
      .eq('id', itemId)
      .single();
    
    if (!item) return;
    
    const newQty = Math.max(0, Number(item.stock_qty || 0) - Number(soldQty));
    
    await supabase
      .from(T.items)
      .update({
        stock_qty: newQty,
        last_sale_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId);
  }

  /**
   * Load customers list
   */
  async function loadCustomers() {
    salesStore.set({ isLoading: true });
    
    try {
      const { data, error } = await supabase
        .from(T.customers)
        .select('*')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      
      salesStore.set({ 
        customers: data || [],
        isLoading: false
      });
      
      return data;
      
    } catch (error) {
      salesStore.set({ isLoading: false });
      throw error;
    }
  }

  /**
   * Load sales orders
   */
  async function loadSalesOrders(status = null) {
    salesStore.set({ isLoading: true });
    
    try {
      let query = supabase
        .from(T.sales_orders)
        .select(`
          *,
          customer:customers(*),
          sales_order_lines(
            *,
            item:items(*)
          )
        `)
        .order('created_at', { ascending: false });
      
      if (status) {
        query = query.eq('status', status);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      salesStore.set({ 
        salesOrders: data || [],
        isLoading: false
      });
      
      return data;
      
    } catch (error) {
      salesStore.set({ isLoading: false });
      throw error;
    }
  }

  /**
   * Generate profitability report
   */
  async function generateProfitabilityReport(formData) {
    const { date_from, date_to, customer_id, item_id } = formData;
    
    try {
      let query = supabase
        .from(T.sales_order_lines)
        .select(`
          *,
          sales_order:sales_orders!inner(
            order_date,
            status,
            customer:customers(name)
          ),
          item:items(name, code)
        `)
        .eq('sales_order.status', 'shipped');
      
      if (date_from) {
        query = query.gte('sales_order.order_date', date_from);
      }
      
      if (date_to) {
        query = query.lte('sales_order.order_date', date_to);
      }
      
      if (customer_id) {
        query = query.eq('sales_order.customer_id', customer_id);
      }
      
      if (item_id) {
        query = query.eq('item_id', item_id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Calculate summary
      const summary = data?.reduce((acc, line) => ({
        totalSales: acc.totalSales + Number(line.total_price || 0),
        totalCost: acc.totalCost + Number(line.total_cost || 0),
        totalProfit: acc.totalProfit + Number(line.gross_profit || 0),
        itemCount: acc.itemCount + 1
      }), { totalSales: 0, totalCost: 0, totalProfit: 0, itemCount: 0 }) || {};
      
      summary.profitMargin = summary.totalSales > 0 ? (summary.totalProfit / summary.totalSales) * 100 : 0;
      
      showToast('تم إنشاء تقرير الربحية', 'success');
      return { data: data || [], summary };
      
    } catch (error) {
      showToast(`خطأ في إنشاء تقرير الربحية: ${error.message}`, 'error');
      throw error;
    }
  }

  // Register all sales actions
  registerActions('sales', {
    'customer:create': createCustomer,
    'customer:update': updateCustomer,
    'customer:load': loadCustomers,
    'so:create': createSalesOrder,
    'so:confirm': confirmSO,
    'so:ship': shipSalesOrder,
    'so:load': loadSalesOrders,
    'so:add-line': addSOLine,
    'order:ship': shipSalesOrder, // Alias
    'report:profitability': generateProfitabilityReport
  });

  console.log('✅ Sales module registered');
}