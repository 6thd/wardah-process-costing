/**
 * Manufacturing Order GetById Module
 * Extracted from supabase-service.ts to reduce complexity
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { 
  isTableNotFoundError, 
  isRelationshipNotFoundError,
  loadRelatedItemData 
} from './helpers';

interface ManufacturingOrderData {
  id: string;
  item_id?: string;
  product_id?: string;
  item?: unknown;
  [key: string]: unknown;
}

/**
 * Try to get order with simple query (no joins)
 */
async function getOrderSimple(
  supabase: SupabaseClient,
  id: string
): Promise<ManufacturingOrderData | null> {
  const { data, error } = await supabase
    .from('manufacturing_orders')
    .select('*')
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST205' || error?.message?.includes('Could not find the table')) {
    return null;
  }

  if (error) throw error;
  return data as ManufacturingOrderData;
}

/**
 * Get manufacturing order by ID with related item data
 */
export async function getManufacturingOrderById(
  getClient: () => Promise<SupabaseClient>,
  id: string
): Promise<ManufacturingOrderData | null> {
  try {
    const supabase = await getClient();

    // Try to get order
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .select('*')
      .eq('id', id)
      .single();

    // Handle missing table
    if (isTableNotFoundError(error)) {
      console.warn('manufacturing_orders table not found');
      return null;
    }

    // Handle missing relationship - try simple query
    if (isRelationshipNotFoundError(error)) {
      const simpleData = await getOrderSimple(supabase, id);
      return simpleData;
    }

    if (error) throw error;

    // Load related item data
    if (data) {
      const orderData = data as ManufacturingOrderData;
      await loadRelatedItemData(supabase, orderData);
      return orderData;
    }

    return data;
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    
    // If table doesn't exist, return null
    if (isTableNotFoundError(err)) {
      console.warn('manufacturing_orders table not found');
      return null;
    }
    
    // If relationship doesn't exist, try simple query
    if (isRelationshipNotFoundError(err)) {
      try {
        const supabase = await getClient();
        return await getOrderSimple(supabase, id);
      } catch (e: unknown) {
        const simpleErr = e as { code?: string };
        if (simpleErr?.code === 'PGRST205') {
          return null;
        }
        throw e;
      }
    }
    
    throw error;
  }
}
