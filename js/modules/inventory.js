import { getSupabase } from '../core/supabase.js';
import { loadConfig, table } from '../core/config.js';
import { registerActions } from '../core/actions.js';
import { inventoryStore } from '../core/store.js';
import { showToast } from '../core/ui-bootstrap.js';

/**
 * Inventory Module - Handle items, stock movements, and inventory management
 */
export async function registerInventory() {
  console.log('📦 Registering Inventory module...');
  
  const cfg = await loadConfig();
  const supabase = await getSupabase();

  // Table mappings
  const T = {
    items: table(cfg, 'items'),
    categories: table(cfg, 'categories'),
    stock_moves: table(cfg, 'stock_moves'),
    locations: table(cfg, 'locations') || 'locations'
  };

  /**
   * Create new item
   */
  async function createItem(formData) {
    const { 
      name, name_ar, code, category_id, unit, 
      cost_price, selling_price, minimum_stock, 
      description, is_stockable = true 
    } = formData;
    
    if (!name || !code || !unit) {
      throw new Error('الاسم والكود ووحدة القياس مطلوبة');
    }
    
    inventoryStore.set({ isLoading: true });
    
    try {
      const itemData = {
        name: name.trim(),
        name_ar: name_ar?.trim() || name.trim(),
        code: code.trim().toUpperCase(),
        category_id: category_id || null,
        unit: unit.trim(),
        cost_price: Number(cost_price || 0),
        avg_cost: Number(cost_price || 0),
        selling_price: Number(selling_price || 0),
        stock_qty: 0,
        minimum_stock: Number(minimum_stock || 0),
        description: description?.trim(),
        is_stockable: is_stockable,
        is_active: true,
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.items)
        .insert([itemData])
        .select('*')
        .single();
      
      if (error) throw error;
      
      // Update store
      const currentItems = inventoryStore.get().items || [];
      inventoryStore.set({ 
        items: [data, ...currentItems]
      });
      
      showToast('تم إضافة الصنف بنجاح', 'success');
      return data;
      
    } finally {
      inventoryStore.set({ isLoading: false });
    }
  }

  /**
   * Update item
   */
  async function updateItem(formData) {
    const { 
      item_id, name, name_ar, category_id, unit,
      cost_price, selling_price, minimum_stock, 
      description, is_active = true 
    } = formData;
    
    if (!item_id || !name) {
      throw new Error('معرف الصنف والاسم مطلوبان');
    }
    
    try {
      const updateData = {
        name: name.trim(),
        name_ar: name_ar?.trim() || name.trim(),
        category_id: category_id || null,
        unit: unit?.trim(),
        cost_price: Number(cost_price || 0),
        selling_price: Number(selling_price || 0),
        minimum_stock: Number(minimum_stock || 0),
        description: description?.trim(),
        is_active: is_active,
        updated_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.items)
        .update(updateData)
        .eq('id', item_id)
        .select('*')
        .single();
      
      if (error) throw error;
      
      showToast('تم تحديث الصنف', 'success');
      return data;
      
    } catch (error) {
      showToast(`خطأ في تحديث الصنف: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Create stock movement (transfer, adjustment, etc.)
   */
  async function createStockMove(formData) {
    const { 
      item_id, qty, move_type = 'TRANSFER', 
      from_location, to_location, location_id,
      unit_cost, ref_no, notes 
    } = formData;
    
    if (!item_id || !qty) {
      throw new Error('الصنف والكمية مطلوبان');
    }
    
    try {
      // Get item data for cost calculation
      const { data: item } = await supabase
        .from(T.items)
        .select('avg_cost, stock_qty')
        .eq('id', item_id)
        .single();
      
      if (!item) throw new Error('الصنف غير موجود');
      
      const moveData = {
        item_id: item_id,
        qty: Number(qty),
        unit_cost: Number(unit_cost || item.avg_cost || 0),
        move_type: move_type,
        location_id: location_id || to_location || 'MAIN-001',
        from_location: from_location,
        to_location: to_location,
        ref_no: ref_no?.trim(),
        notes: notes?.trim(),
        source: 'MANUAL',
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from(T.stock_moves)
        .insert([moveData])
        .select(`
          *,
          item:items(*)
        `)
        .single();
      
      if (error) throw error;
      
      // Update item stock quantity for IN/OUT moves
      if (move_type === 'IN' || move_type === 'OUT' || move_type === 'ADJUSTMENT') {
        await updateItemStock(item_id, move_type, Number(qty));
      }
      
      showToast('تم إنشاء حركة المخزون', 'success');
      return data;
      
    } catch (error) {
      showToast(`خطأ في حركة المخزون: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Update item stock quantity
   */
  async function updateItemStock(itemId, moveType, qty) {
    const { data: item } = await supabase
      .from(T.items)
      .select('stock_qty')
      .eq('id', itemId)
      .single();
    
    if (!item) return;
    
    let newQty = Number(item.stock_qty || 0);
    
    if (moveType === 'IN') {
      newQty += qty;
    } else if (moveType === 'OUT') {
      newQty -= qty;
    } else if (moveType === 'ADJUSTMENT') {
      newQty = qty; // Adjustment sets absolute quantity
    }
    
    await supabase
      .from(T.items)
      .update({
        stock_qty: Math.max(0, newQty),
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId);
  }

  /**
   * Stock adjustment
   */
  async function adjustStock(formData) {
    const { item_id, new_qty, reason, ref_no } = formData;
    
    if (!item_id || new_qty === undefined) {
      throw new Error('الصنف والكمية الجديدة مطلوبان');
    }
    
    try {
      // Get current stock
      const { data: item } = await supabase
        .from(T.items)
        .select('stock_qty, avg_cost')
        .eq('id', item_id)
        .single();
      
      if (!item) throw new Error('الصنف غير موجود');
      
      const currentQty = Number(item.stock_qty || 0);
      const adjustmentQty = Number(new_qty) - currentQty;
      
      if (adjustmentQty === 0) {
        showToast('لا يوجد تغيير في الكمية', 'info');
        return;
      }
      
      // Create adjustment movement
      const moveData = {
        item_id: item_id,
        qty: Math.abs(adjustmentQty),
        unit_cost: Number(item.avg_cost || 0),
        move_type: adjustmentQty > 0 ? 'IN' : 'OUT',
        location_id: 'MAIN-001',
        ref_no: ref_no || `ADJ-${Date.now()}`,
        notes: `تسوية مخزون: ${reason || 'تسوية يدوية'}`,
        source: 'ADJUSTMENT',
        created_at: new Date().toISOString()
      };
      
      // Insert movement and update stock
      const { error: moveError } = await supabase
        .from(T.stock_moves)
        .insert([moveData]);
      
      if (moveError) throw moveError;
      
      // Update item stock
      const { error: itemError } = await supabase
        .from(T.items)
        .update({
          stock_qty: Number(new_qty),
          updated_at: new Date().toISOString()
        })
        .eq('id', item_id);
      
      if (itemError) throw itemError;
      
      showToast('تم تسوية المخزون بنجاح', 'success');
      
    } catch (error) {
      showToast(`خطأ في تسوية المخزون: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Load items with optional filtering
   */
  async function loadItems(filters = {}) {
    inventoryStore.set({ isLoading: true });
    
    try {
      let query = supabase
        .from(T.items)
        .select('*')
        .eq('is_active', true)
        .order('name');
      
      // Apply filters
      if (filters.category_id) {
        query = query.eq('category_id', filters.category_id);
      }
      
      if (filters.low_stock) {
        query = query.filter('stock_qty', 'lte', 'minimum_stock');
      }
      
      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,code.ilike.%${filters.search}%`);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      inventoryStore.set({ 
        items: data || [],
        isLoading: false
      });
      
      return data;
      
    } catch (error) {
      inventoryStore.set({ isLoading: false });
      throw error;
    }
  }

  /**
   * Load stock movements
   */
  async function loadStockMovements(filters = {}) {
    try {
      let query = supabase
        .from(T.stock_moves)
        .select(`
          *,
          item:items(*)
        `)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (filters.item_id) {
        query = query.eq('item_id', filters.item_id);
      }
      
      if (filters.move_type) {
        query = query.eq('move_type', filters.move_type);
      }
      
      if (filters.date_from) {
        query = query.gte('created_at', filters.date_from);
      }
      
      if (filters.date_to) {
        query = query.lte('created_at', filters.date_to);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      inventoryStore.set({ stockMovements: data || [] });
      return data;
      
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate kardex report for an item
   */
  async function generateKardex(formData) {
    const { item_id, date_from, date_to } = formData;
    
    if (!item_id) {
      throw new Error('معرف الصنف مطلوب');
    }
    
    try {
      let query = supabase
        .from(T.stock_moves)
        .select(`
          *,
          item:items(name, code, unit)
        `)
        .eq('item_id', item_id)
        .order('created_at', { ascending: true });
      
      if (date_from) {
        query = query.gte('created_at', date_from);
      }
      
      if (date_to) {
        query = query.lte('created_at', date_to);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Calculate running balance
      let balance = 0;
      let runningValue = 0;
      
      const kardexData = data.map(move => {
        const qty = Number(move.qty || 0);
        const unitCost = Number(move.unit_cost || 0);
        const value = qty * unitCost;
        
        if (move.move_type === 'IN' || move.move_type === 'IN-WIP') {
          balance += qty;
          runningValue += value;
        } else if (move.move_type === 'OUT') {
          balance -= qty;
          runningValue -= value;
        }
        
        return {
          ...move,
          balance: balance,
          running_value: runningValue,
          avg_cost: balance > 0 ? runningValue / balance : 0
        };
      });
      
      showToast('تم إنشاء تقرير الكارتكس', 'success');
      return kardexData;
      
    } catch (error) {
      showToast(`خطأ في إنشاء الكارتكس: ${error.message}`, 'error');
      throw error;
    }
  }

  // Register all inventory actions
  registerActions('inv', {
    'item:create': createItem,
    'item:update': updateItem,
    'item:load': loadItems,
    'stock:move': createStockMove,
    'stock:adjust': adjustStock,
    'stock:transfer': createStockMove, // Alias for transfers
    'moves:load': loadStockMovements,
    'kardex:generate': generateKardex,
    'report:kardex': generateKardex // Alias
  });

  console.log('✅ Inventory module registered');
}