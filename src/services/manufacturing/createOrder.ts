/**
 * Manufacturing Order Creation Module
 * Extracted from supabase-service.ts to reduce complexity
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface ManufacturingOrderInput {
  order_number?: string;
  product_id?: string;
  item_id?: string;
  quantity: number;
  status?: string;
  notes?: string;
  start_date?: string;
  due_date?: string;
  [key: string]: unknown;
}

interface MaterialInput {
  item_id: string;
  quantity: number;
  unit_cost?: number;
}

interface DataWithItem {
  id: string;
  item_id?: string;
  product_id?: string;
  item?: unknown;
  [key: string]: unknown;
}

/**
 * Check material availability using inventory transaction service
 */
async function checkMaterialAvailability(
  materials: MaterialInput[]
): Promise<void> {
  const { inventoryTransactionService } = await import('../inventory-transaction-service');
  
  const availability = await inventoryTransactionService.checkAvailability(
    materials.map(m => ({
      item_id: m.item_id,
      quantity: m.quantity,
      unit_cost: m.unit_cost,
    }))
  );
  
  const insufficient = availability.filter(a => !a.sufficient);
  if (insufficient.length > 0) {
    const item = insufficient[0];
    throw new Error(
      `المخزون غير كافٍ للمادة. المطلوب: ${item.required}، المتاح: ${item.available}`
    );
  }
}

/**
 * Reserve materials for manufacturing order
 */
async function reserveMaterials(
  orderId: string,
  materials: MaterialInput[]
): Promise<void> {
  const { inventoryTransactionService } = await import('../inventory-transaction-service');
  
  try {
    await inventoryTransactionService.reserveMaterials(
      orderId,
      materials.map(m => ({
        item_id: m.item_id,
        quantity: m.quantity,
        unit_cost: m.unit_cost,
      }))
    );
  } catch (reservationError) {
    // If reservation fails, log the error
    // In production, this should be in a transaction
    console.error('Failed to reserve materials after order creation:', reservationError);
  }
}

/**
 * Load related product/item data for order
 */
async function loadRelatedProductData(
  supabase: SupabaseClient,
  data: DataWithItem
): Promise<void> {
  const itemId = data.item_id || data.product_id;
  if (!itemId) return;

  try {
    const { data: product } = await supabase
      .from('products')
      .select('id, code, name')
      .eq('id', itemId)
      .single();

    if (product) {
      data.item = product;
    }
  } catch (e) {
    // Ignore errors loading related data
    console.warn('Could not load related data:', e);
  }
}

/**
 * Check if error is a relationship not found error
 */
function isRelationshipError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST200' || error?.message?.includes('Could not find a relationship') || false;
}

/**
 * Insert order and return data
 */
async function insertOrder(
  supabase: SupabaseClient,
  order: ManufacturingOrderInput
): Promise<DataWithItem> {
  const { data, error } = await supabase
    .from('manufacturing_orders')
    .insert(order)
    .select('*')
    .single();

  // Handle missing relationship gracefully
  if (isRelationshipError(error)) {
    const { data: simpleData, error: simpleError } = await supabase
      .from('manufacturing_orders')
      .insert(order)
      .select('*')
      .single();

    if (simpleError) throw simpleError;
    return simpleData as DataWithItem;
  }

  if (error) throw error;
  return data as DataWithItem;
}

function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.message?.includes('Could not find the function') || false;
}

/**
 * Create a manufacturing order with optional material reservation.
 * Uses rpc_create_mo_with_reservation (atomic) when Migration 78 is applied,
 * falls back to the legacy two-step approach otherwise.
 */
export async function createManufacturingOrder(
  getClient: () => Promise<SupabaseClient>,
  order: ManufacturingOrderInput,
  materials?: MaterialInput[]
): Promise<DataWithItem> {
  const supabase = await getClient();

  // ===== المسار الذرّي: RPC واحد يُنشئ الأمر ويحجز المواد في معاملة واحدة =====
  if (materials && materials.length > 0) {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'rpc_create_mo_with_reservation',
      {
        p_order: order,
        p_materials: materials.map(m => ({
          item_id: m.item_id,
          quantity: m.quantity,
        })),
        p_tenant: null,
      }
    );

    if (!rpcError && rpcData?.success) {
      // نجح — نُعيد بيانات الأمر المنشأ مع تحميل بيانات المنتج
      const result: DataWithItem = {
        id: rpcData.mo_id,
        ...order,
      };
      await loadRelatedProductData(supabase, result);
      return result;
    }

    // خطأ DB حقيقي (مخزون غير كافٍ، بيانات ناقصة...) — يصل للمستخدم
    if (rpcError && !isMissingFunctionError(rpcError)) {
      throw new Error(`فشل إنشاء أمر التصنيع: ${rpcError.message}`);
    }

    // Migration 78 غير مطبَّق — نرجع للمسار القديم مع تحذير
    console.warn(
      '[createManufacturingOrder] rpc_create_mo_with_reservation غير متاح، ' +
      'جاري استخدام المسار القديم (إنشاء ثم حجز منفصل). طبّق Migration 78 لضمان الذرّية.'
    );
  }

  // ===== Fallback: المسار القديم (خطوتان — غير ذرّي) =====
  if (materials && materials.length > 0) {
    try {
      await checkMaterialAvailability(materials);
    } catch (error) {
      if (error instanceof Error && error.message.includes('المخزون غير كافٍ')) {
        throw error;
      }
      throw new Error(`فشل في التحقق من توفر المواد: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    }
  }

  const data = await insertOrder(supabase, order);

  if (data && materials && materials.length > 0) {
    await reserveMaterials(data.id, materials);
  }

  if (data) {
    await loadRelatedProductData(supabase, data);
  }

  return data;
}
