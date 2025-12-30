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
 * Handle error and retry with simple query
 */
async function handleErrorAndRetry(
  getClient: () => Promise<SupabaseClient>,
  id: string,
  error: unknown
): Promise<ManufacturingOrderData | null> {
  if (isTableNotFoundError(error)) {
    console.warn('manufacturing_orders table not found');
    return null;
  }

  if (isRelationshipNotFoundError(error)) {
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

/**
 * Get manufacturing order by ID with related item data
 */
// eslint-disable-next-line complexity
export async function getManufacturingOrderById(
  getClient: () => Promise<SupabaseClient>,
  id: string
): Promise<ManufacturingOrderData | null> {
  try {
    const supabase = await getClient();

    const { data, error } = await supabase
      .from('manufacturing_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return await handleErrorAndRetry(getClient, id, error);
    }

    if (data) {
      const orderData = data as ManufacturingOrderData;
      await loadRelatedItemData(supabase, orderData);
      return orderData;
    }

    return null;
  } catch (error: unknown) {
    return await handleErrorAndRetry(getClient, id, error);
  }
}
