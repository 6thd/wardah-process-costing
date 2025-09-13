import { getSupabase } from '../core/supabase.js';
import { loadConfig, table } from '../core/config.js';
import { registerActions } from '../core/actions.js';
import { purchasingStore } from '../core/store.js';
import { showToast } from '../core/ui-bootstrap.js';

/**
 * Purchasing Module - Handle suppliers, purchase orders, and goods receiving
 */
export async function registerPurchasing() {
  console.log('📦 Registering Purchasing module...');
  
  const cfg = await loadConfig();
  const supabase = await getSupabase();

  // Table mappings
  const T = {
    suppliers: table(cfg, 'suppliers'),
    purchase_orders: table(cfg, 'purchase_orders'),
    purchase_order_lines: table(cfg, 'purchase_order_lines'),
    stock_moves: table(cfg, 'stock_moves'),
    items: table(cfg, 'items')
  };

  /**
   * Create a new supplier
   */
  async function createSupplier(formData) {
    const { name, name_ar, code, contact_person, phone, email, address } = formData;
    
    if (!name || !code) {
      throw new Error('اسم المورد والكود مطلوبان');
    }
    
    purchasingStore.set({ isLoading: true });
    
    try {
      const supplierData = {
        name: name.trim(),
        name_ar: name_ar?.trim() || name.trim(),
        code: code.trim().toUpperCase(),
        contact_person: contact_person?.trim(),
        phone: phone?.trim(),
        email: email?.trim(),
        address: address?.trim(),
        is_active: true,
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.suppliers)
        .insert([supplierData])
        .select()
        .single();
      
      if (error) throw error;
      
      // Update store
      const currentSuppliers = purchasingStore.get().suppliers || [];
      purchasingStore.set({ 
        suppliers: [data, ...currentSuppliers]
      });
      
      showToast('تم حفظ المورد بنجاح', 'success');
      return data;
      
    } finally {
      purchasingStore.set({ isLoading: false });
    }
  }

  /**
   * Update supplier
   */
  async function updateSupplier(formData) {
    const { supplier_id, name, name_ar, contact_person, phone, email, address, is_active } = formData;
    
    if (!supplier_id || !name) {
      throw new Error('معرف المورد والاسم مطلوبان');
    }
    
    try {
      const updateData = {
        name: name.trim(),
        name_ar: name_ar?.trim() || name.trim(),
        contact_person: contact_person?.trim(),
        phone: phone?.trim(),
        email: email?.trim(),
        address: address?.trim(),
        is_active: is_active !== undefined ? is_active : true,
        updated_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.suppliers)
        .update(updateData)
        .eq('id', supplier_id)
        .select()
        .single();
      
      if (error) throw error;
      
      showToast('تم تحديث بيانات المورد', 'success');
      return data;
      
    } catch (error) {
      showToast(`خطأ في تحديث المورد: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Create purchase order
   */
  async function createPurchaseOrder(formData) {
    const { supplier_id, po_number, order_date, expected_date, notes } = formData;
    
    if (!supplier_id) {
      throw new Error('يجب اختيار المورد');
    }
    
    purchasingStore.set({ isLoading: true });
    
    try {
      const poData = {
        supplier_id: supplier_id,
        po_number: po_number || `PO-${Date.now()}`,
        order_date: order_date || new Date().toISOString().split('T')[0],
        expected_date: expected_date,
        status: 'draft',
        total_amount: 0,
        notes: notes?.trim(),
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.purchase_orders)
        .insert([poData])
        .select(`
          *,
          supplier:suppliers(*)
        `)
        .single();
      
      if (error) throw error;
      
      purchasingStore.set({ currentPO: data });
      showToast('تم إنشاء أمر الشراء', 'success');
      return data;
      
    } finally {
      purchasingStore.set({ isLoading: false });
    }
  }

  /**
   * Add line item to purchase order
   */
  async function addPOLine(formData) {
    const { po_id, item_id, qty, unit_price, notes } = formData;
    
    if (!po_id || !item_id || !qty || !unit_price) {
      throw new Error('جميع البيانات مطلوبة: أمر الشراء، الصنف، الكمية، السعر');
    }
    
    try {
      const lineData = {
        po_id: po_id,
        item_id: item_id,
        qty: Number(qty),
        unit_price: Number(unit_price),
        total_price: Number(qty) * Number(unit_price),
        notes: notes?.trim(),
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.purchase_order_lines)
        .insert([lineData])
        .select(`
          *,
          item:items(*)
        `)
        .single();
      
      if (error) throw error;
      
      // Update PO total
      await updatePOTotal(po_id);
      
      showToast('تم إضافة بند الشراء', 'success');
      return data;
      
    } catch (error) {
      showToast(`خطأ في إضافة البند: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Update purchase order total
   */
  async function updatePOTotal(poId) {
    const { data: lines } = await supabase
      .from(T.purchase_order_lines)
      .select('total_price')
      .eq('po_id', poId);
    
    const total = lines?.reduce((sum, line) => sum + Number(line.total_price), 0) || 0;
    
    await supabase
      .from(T.purchase_orders)
      .update({ 
        total_amount: total,
        updated_at: new Date().toISOString()
      })
      .eq('id', poId);
  }

  /**
   * Confirm purchase order
   */
  async function confirmPO(formData) {
    const { po_id } = formData;
    
    if (!po_id) {
      throw new Error('معرف أمر الشراء مطلوب');
    }
    
    try {
      const { data, error } = await supabase
        .from(T.purchase_orders)
        .update({
          status: 'confirmed',
          confirmed_date: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', po_id)
        .select()
        .single();
      
      if (error) throw error;
      
      showToast('تم تأكيد أمر الشراء', 'success');
      return data;
      
    } catch (error) {
      showToast(`خطأ في تأكيد الأمر: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Receive goods with AVCO costing
   */
  async function receiveGoods(formData) {
    const { 
      po_id, 
      item_id, 
      qty, 
      unit_cost, 
      location_id = 'MAIN-001', 
      ref_no,
      inspection_notes 
    } = formData;
    
    if (!po_id || !item_id || !qty || !unit_cost) {
      throw new Error('جميع البيانات مطلوبة للاستلام');
    }
    
    purchasingStore.set({ isLoading: true });
    
    try {
      // Try RPC function for AVCO receiving
      const { data, error } = await supabase.rpc('inv_receive_and_avco', {
        p_po: po_id,
        p_item: item_id,
        p_qty: Number(qty),
        p_unit_cost: Number(unit_cost),
        p_location: location_id,
        p_ref: ref_no || po_id
      });
      
      if (error) {
        // Fallback to manual receiving
        await manualReceiveAndAVCO(formData);
      } else {
        showToast('تم الاستلام وتحديث متوسط التكلفة', 'success');
      }
      
    } catch (error) {
      console.error('Goods receiving error:', error);
      showToast(`خطأ في الاستلام: ${error.message}`, 'error');
    } finally {
      purchasingStore.set({ isLoading: false });
    }
  }

  /**
   * Manual goods receiving with AVCO fallback
   */
  async function manualReceiveAndAVCO(formData) {
    const { po_id, item_id, qty, unit_cost, location_id, ref_no, inspection_notes } = formData;
    
    // Get current item data
    const { data: item } = await supabase
      .from(T.items)
      .select('avg_cost, stock_qty')
      .eq('id', item_id)
      .single();
    
    if (!item) throw new Error('الصنف غير موجود');
    
    // Calculate new average cost using AVCO
    const currentQty = Number(item.stock_qty || 0);
    const currentCost = Number(item.avg_cost || 0);
    const receivedQty = Number(qty);
    const receivedCost = Number(unit_cost);
    
    const newQty = currentQty + receivedQty;
    let newAvgCost;
    
    if (newQty > 0) {
      newAvgCost = ((currentQty * currentCost) + (receivedQty * receivedCost)) / newQty;
    } else {
      newAvgCost = receivedCost;
    }
    
    // Create stock movement
    const stockMove = {
      item_id: item_id,
      qty: receivedQty,
      unit_cost: receivedCost,
      move_type: 'IN',
      location_id: location_id || 'MAIN-001',
      source: 'PO',
      source_id: po_id,
      ref_no: ref_no || po_id,
      notes: inspection_notes ? `استلام مشتريات - ${inspection_notes}` : 'استلام مشتريات',
      created_at: new Date().toISOString()
    };
    
    const { error: moveError } = await supabase.from(T.stock_moves).insert([stockMove]);
    if (moveError) throw moveError;
    
    // Update item with new average cost and quantity
    const { error: itemError } = await supabase
      .from(T.items)
      .update({
        avg_cost: newAvgCost,
        stock_qty: newQty,
        last_purchase_cost: receivedCost,
        last_purchase_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', item_id);
    
    if (itemError) throw itemError;
    
    showToast('تم الاستلام وتحديث متوسط التكلفة يدوياً', 'success');
  }

  /**
   * Load suppliers list
   */
  async function loadSuppliers() {
    purchasingStore.set({ isLoading: true });
    
    try {
      const { data, error } = await supabase
        .from(T.suppliers)
        .select('*')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      
      purchasingStore.set({ 
        suppliers: data || [],
        isLoading: false
      });
      
      return data;
      
    } catch (error) {
      purchasingStore.set({ isLoading: false });
      throw error;
    }
  }

  /**
   * Load purchase orders
   */
  async function loadPurchaseOrders(status = null) {
    purchasingStore.set({ isLoading: true });
    
    try {
      let query = supabase
        .from(T.purchase_orders)
        .select(`
          *,
          supplier:suppliers(*),
          purchase_order_lines(
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
      
      purchasingStore.set({ 
        purchaseOrders: data || [],
        isLoading: false
      });
      
      return data;
      
    } catch (error) {
      purchasingStore.set({ isLoading: false });
      throw error;
    }
  }

  // Register all purchasing actions
  registerActions('purch', {
    'supplier:create': createSupplier,
    'supplier:update': updateSupplier,
    'supplier:load': loadSuppliers,
    'po:create': createPurchaseOrder,
    'po:confirm': confirmPO,
    'po:load': loadPurchaseOrders,
    'po:add-line': addPOLine,
    'grn:receive': receiveGoods,
    'goods:receive': receiveGoods, // Alias
    'receive:goods': receiveGoods  // Another alias
  });

  console.log('✅ Purchasing module registered');
}