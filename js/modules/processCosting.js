import { getSupabase } from '../core/supabase.js';
import { loadConfig, table } from '../core/config.js';
import { registerActions } from '../core/actions.js';
import { processCostingStore } from '../core/store.js';
import { showToast } from '../core/ui-bootstrap.js';

/**
 * Process Costing Module - Handle all stage costing logic
 */
export async function registerProcessCosting() {
  console.log('📦 Registering Process Costing module...');
  
  const cfg = await loadConfig();
  const supabase = await getSupabase();

  // Table mappings
  const T = {
    stage_costs: table(cfg, 'stage_costs'),
    labor_time_logs: table(cfg, 'labor_time_logs'),
    moh_applied: table(cfg, 'moh_applied'),
    manufacturing_orders: table(cfg, 'manufacturing_orders'),
    boms: table(cfg, 'boms'),
    items: table(cfg, 'items'),
    stock_moves: table(cfg, 'stock_moves'),
    work_centers: table(cfg, 'work_centers') || 'work_centers'
  };

  /**
   * Log labor hours for a manufacturing stage
   */
  async function logLabor(formData) {
    const { mo_id, stage_no, hours, hourly_rate, worker_name } = formData;
    
    if (!mo_id || !stage_no || !hours || !hourly_rate) {
      throw new Error('المعلومات مطلوبة: أمر التصنيع، رقم المرحلة، الساعات، والمعدل');
    }
    
    processCostingStore.set({ isCalculating: true });
    
    try {
      const { error } = await supabase.from(T.labor_time_logs).insert([{
        mo_id: mo_id,
        stage_no: Number(stage_no),
        hours: Number(hours),
        hourly_rate: Number(hourly_rate),
        worker_name: worker_name || 'غير محدد',
        total_cost: Number(hours) * Number(hourly_rate),
        created_at: new Date().toISOString()
      }]);
      
      if (error) throw error;
      
      showToast('تم حفظ ساعات العمالة بنجاح', 'success');
    } finally {
      processCostingStore.set({ isCalculating: false });
    }
  }

  /**
   * Apply manufacturing overhead to a stage
   */
  async function applyOverhead(formData) {
    const { mo_id, stage_no, base_qty, rate, overhead_type = 'machine_hours' } = formData;
    
    if (!mo_id || !stage_no || !base_qty || !rate) {
      throw new Error('المعلومات مطلوبة: أمر التصنيع، رقم المرحلة، الكمية الأساسية، والمعدل');
    }
    
    processCostingStore.set({ isCalculating: true });
    
    try {
      const totalCost = Number(base_qty) * Number(rate);
      
      const { error } = await supabase.from(T.moh_applied).insert([{
        mo_id: mo_id,
        stage_no: Number(stage_no),
        base_qty: Number(base_qty),
        rate: Number(rate),
        overhead_type: overhead_type,
        total_cost: totalCost,
        created_at: new Date().toISOString()
      }]);
      
      if (error) throw error;
      
      showToast('تم تطبيق الأوفرهيد بنجاح', 'success');
    } finally {
      processCostingStore.set({ isCalculating: false });
    }
  }

  /**
   * Recalculate stage costs
   */
  async function recalculateStage(formData) {
    const { mo_id, stage_no, wc_id, good_qty, dm_cost = 0 } = formData;
    
    if (!mo_id || !stage_no || !good_qty) {
      throw new Error('المعلومات مطلوبة: أمر التصنيع، رقم المرحلة، والكمية الجيدة');
    }
    
    processCostingStore.set({ 
      isCalculating: true, 
      currentStage: { mo_id, stage_no } 
    });
    
    try {
      // Try using RPC function first
      const { data, error } = await supabase.rpc('upsert_stage_cost', {
        p_mo: mo_id,
        p_stage: Number(stage_no),
        p_wc: wc_id,
        p_good_qty: Number(good_qty),
        p_dm: Number(dm_cost),
        p_mode: 'precosted'
      });
      
      if (error) {
        // Fallback to manual calculation
        await manualStageCalculation(formData);
      } else {
        processCostingStore.set({ 
          lastCalculation: data?.[0] || null 
        });
        showToast('تم احتساب المرحلة بنجاح', 'success');
      }
    } catch (error) {
      console.error('Stage calculation error:', error);
      showToast(`خطأ في احتساب المرحلة: ${error.message}`, 'error');
    } finally {
      processCostingStore.set({ 
        isCalculating: false,
        currentStage: null 
      });
    }
  }

  /**
   * Manual stage calculation fallback
   */
  async function manualStageCalculation(formData) {
    const { mo_id, stage_no, wc_id, good_qty, dm_cost = 0 } = formData;
    
    // Get labor costs for this stage
    const { data: laborLogs } = await supabase
      .from(T.labor_time_logs)
      .select('total_cost')
      .eq('mo_id', mo_id)
      .eq('stage_no', stage_no);
    
    const laborCost = laborLogs?.reduce((sum, log) => sum + Number(log.total_cost), 0) || 0;
    
    // Get MOH costs for this stage
    const { data: mohApplied } = await supabase
      .from(T.moh_applied)
      .select('total_cost')
      .eq('mo_id', mo_id)
      .eq('stage_no', stage_no);
    
    const overheadCost = mohApplied?.reduce((sum, moh) => sum + Number(moh.total_cost), 0) || 0;
    
    // Get transferred-in cost from previous stage
    let transferredInCost = 0;
    if (Number(stage_no) > 1) {
      const { data: prevStage } = await supabase
        .from(T.stage_costs)
        .select('total_cost')
        .eq('mo_id', mo_id)
        .eq('stage_no', Number(stage_no) - 1)
        .single();
      
      transferredInCost = Number(prevStage?.total_cost || 0);
    }
    
    // Calculate totals
    const totalCost = Number(dm_cost) + laborCost + overheadCost + transferredInCost;
    const unitCost = Number(good_qty) > 0 ? totalCost / Number(good_qty) : 0;
    
    // Upsert stage cost
    const { data, error } = await supabase
      .from(T.stage_costs)
      .upsert({
        mo_id: mo_id,
        stage_no: Number(stage_no),
        wc_id: wc_id,
        input_qty: Number(good_qty), // Simplified
        good_qty: Number(good_qty),
        scrap_qty: 0,
        dm_cost: Number(dm_cost),
        labor_cost: laborCost,
        overhead_cost: overheadCost,
        transferred_in_cost: transferredInCost,
        total_cost: totalCost,
        unit_cost: unitCost,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'mo_id,stage_no'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    processCostingStore.set({ lastCalculation: data });
    showToast('تم احتساب المرحلة يدوياً', 'success');
  }

  /**
   * Finish manufacturing order and transfer to finished goods
   */
  async function finishManufacturingOrder(formData) {
    const { mo_id, fg_item_id, good_qty, fg_location_id } = formData;
    
    if (!mo_id || !fg_item_id || !good_qty) {
      throw new Error('المعلومات مطلوبة: أمر التصنيع، صنف المنتج النهائي، والكمية');
    }
    
    processCostingStore.set({ isCalculating: true });
    
    try {
      // Try RPC function first
      const { data, error } = await supabase.rpc('finish_mo_to_stock', {
        p_mo: mo_id,
        p_fg_item: fg_item_id,
        p_qty: Number(good_qty),
        p_location: fg_location_id
      });
      
      if (error) {
        // Fallback to manual finish
        await manualFinishMO(formData);
      } else {
        showToast('تم إنهاء أمر التصنيع وتحويل المنتج للمخزون', 'success');
      }
      
      // Update MO status
      await supabase
        .from(T.manufacturing_orders)
        .update({
          status: 'completed',
          actual_end_date: new Date().toISOString(),
          qty_produced: Number(good_qty)
        })
        .eq('id', mo_id);
        
    } finally {
      processCostingStore.set({ isCalculating: false });
    }
  }

  /**
   * Manual MO finish fallback
   */
  async function manualFinishMO(formData) {
    const { mo_id, fg_item_id, good_qty, fg_location_id } = formData;
    
    // Get final stage unit cost
    const { data: finalStage } = await supabase
      .from(T.stage_costs)
      .select('unit_cost')
      .eq('mo_id', mo_id)
      .order('stage_no', { ascending: false })
      .limit(1)
      .single();
    
    const unitCost = Number(finalStage?.unit_cost || 0);
    
    // Create stock movement for finished goods
    const stockMove = {
      item_id: fg_item_id,
      qty: Number(good_qty),
      unit_cost: unitCost,
      move_type: 'IN',
      location_id: fg_location_id || 'FG-001',
      source: 'MO',
      source_id: mo_id,
      ref_no: mo_id,
      notes: `إنتاج من أمر التصنيع ${mo_id}`,
      created_at: new Date().toISOString()
    };
    
    const { error } = await supabase.from(T.stock_moves).insert([stockMove]);
    if (error) throw error;
    
    // Update item average cost using AVCO
    await updateItemAverageCost(fg_item_id, Number(good_qty), unitCost);
  }

  /**
   * Consume BOM materials to WIP
   */
  async function consumeBOMToWIP(formData) {
    const { mo_id, rm_location_id = 'RM-001', wip_location_id = 'WIP-001' } = formData;
    
    if (!mo_id) {
      throw new Error('رقم أمر التصنيع مطلوب');
    }
    
    processCostingStore.set({ isCalculating: true });
    
    try {
      // Get MO details
      const { data: mo } = await supabase
        .from(T.manufacturing_orders)
        .select('id, product_id, qty_to_produce')
        .eq('id', mo_id)
        .single();
      
      if (!mo) throw new Error('أمر التصنيع غير موجود');
      
      // Get BOM lines
      const { data: bomLines } = await supabase
        .from(T.boms)
        .select('component_id, qty_per')
        .eq('product_id', mo.product_id);
      
      if (!bomLines || bomLines.length === 0) {
        throw new Error('لا توجد قائمة مواد لهذا المنتج');
      }
      
      // Process each BOM line
      for (const line of bomLines) {
        const qtyNeeded = Number(line.qty_per) * Number(mo.qty_to_produce);
        
        // Get item average cost
        const { data: item } = await supabase
          .from(T.items)
          .select('avg_cost')
          .eq('id', line.component_id)
          .single();
        
        const avgCost = Number(item?.avg_cost || 0);
        
        // OUT movement from raw materials
        const outMove = {
          item_id: line.component_id,
          qty: qtyNeeded,
          unit_cost: avgCost,
          move_type: 'OUT',
          location_id: rm_location_id,
          source: 'MO',
          source_id: mo.id,
          ref_no: mo_id,
          notes: `استهلاك مواد خام لأمر التصنيع ${mo_id}`,
          created_at: new Date().toISOString()
        };
        
        // IN-WIP movement
        const wipMove = {
          item_id: mo.product_id,
          qty: qtyNeeded,
          unit_cost: avgCost,
          move_type: 'IN-WIP',
          location_id: wip_location_id,
          source: 'MO',
          source_id: mo.id,
          ref_no: mo_id,
          notes: `تحويل مواد لإنتاج تحت التشغيل ${mo_id}`,
          created_at: new Date().toISOString()
        };
        
        // Insert movements
        const { error: outError } = await supabase.from(T.stock_moves).insert([outMove]);
        if (outError) throw outError;
        
        const { error: wipError } = await supabase.from(T.stock_moves).insert([wipMove]);
        if (wipError) throw wipError;
      }
      
      showToast('تم استهلاك مواد BOM للإنتاج تحت التشغيل', 'success');
      
    } finally {
      processCostingStore.set({ isCalculating: false });
    }
  }

  /**
   * Update item average cost using AVCO
   */
  async function updateItemAverageCost(itemId, qty, unitCost) {
    const { data: item } = await supabase
      .from(T.items)
      .select('avg_cost, stock_qty')
      .eq('id', itemId)
      .single();
    
    if (!item) return;
    
    const currentQty = Number(item.stock_qty || 0);
    const currentCost = Number(item.avg_cost || 0);
    const newQty = currentQty + Number(qty);
    
    let newAvgCost;
    if (newQty > 0) {
      newAvgCost = ((currentQty * currentCost) + (Number(qty) * Number(unitCost))) / newQty;
    } else {
      newAvgCost = Number(unitCost);
    }
    
    await supabase
      .from(T.items)
      .update({
        avg_cost: newAvgCost,
        stock_qty: newQty
      })
      .eq('id', itemId);
  }

  // Register all process costing actions
  registerActions('mfg', {
    'stage:log-labor': logLabor,
    'stage:apply-oh': applyOverhead,
    'stage:apply-overhead': applyOverhead, // Alias
    'stage:recalc': recalculateStage,
    'stage:recalculate': recalculateStage, // Alias
    'mo:finish': finishManufacturingOrder,
    'mo:complete': finishManufacturingOrder, // Alias
    'bom:consume': consumeBOMToWIP,
    'bom:consume-to-wip': consumeBOMToWIP // Alias
  });

  console.log('✅ Process Costing module registered');
}