/**
 * Manufacturing Service Helpers
 * Extracted to reduce complexity in main service file
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Normalize status from database format to frontend format
 */
export function normalizeStatus(status: string | undefined): string {
  if (!status) return 'draft';
  
  const statusMap: Record<string, string> = {
    'in_progress': 'in-progress',
    'done': 'completed'
  };
  
  return statusMap[status] || status;
}

/**
 * Prepare update data based on status transition
 */
export function prepareStatusUpdateData(
  status: string,
  providedUpdateData?: Record<string, unknown>
): Record<string, unknown> {
  const updateData: Record<string, unknown> = providedUpdateData 
    ? { ...providedUpdateData } 
    : {};

  updateData.status = status;
  updateData.updated_at = new Date().toISOString();

  return updateData;
}

/**
 * Check if status transition should set end_date
 */
export function shouldSetEndDate(
  status: string, 
  providedUpdateData?: Record<string, unknown>
): boolean {
  const completedStatuses = ['completed', 'done'];
  const hasProvidedEndDate = providedUpdateData?.end_date;
  
  return completedStatuses.includes(status) && !hasProvidedEndDate;
}

/**
 * Check if status transition should set start_date
 */
export function shouldSetStartDate(
  status: string,
  providedUpdateData?: Record<string, unknown>
): boolean {
  const inProgressStatuses = ['in-progress', 'in_progress'];
  const hasProvidedStartDate = providedUpdateData?.start_date;
  
  return inProgressStatuses.includes(status) && !hasProvidedStartDate;
}

/**
 * Load related item/product data for a manufacturing order
 */
export async function loadRelatedItemData(
  supabase: SupabaseClient,
  data: Record<string, unknown>
): Promise<void> {
  const itemId = (data.item_id || data.product_id) as string | undefined;
  
  if (!itemId) return;

  try {
    // Try products table first
    const { data: product } = await supabase
      .from('products')
      .select('id, code, name')
      .eq('id', itemId)
      .single();

    if (product) {
      data.item = product;
      return;
    }

    // Fallback to items table
    const { data: item } = await supabase
      .from('items')
      .select('id, code, name, sku')
      .eq('id', itemId)
      .single();

    if (item) {
      data.item = item;
    }
  } catch (e) {
    console.warn('Could not load related data:', e);
  }
}

/**
 * Check if error is a table not found error
 */
export function isTableNotFoundError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || 
         error.message?.includes('Could not find the table') || 
         false;
}

/**
 * Check if error is a relationship not found error
 */
export function isRelationshipNotFoundError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST200' || 
         error.message?.includes('Could not find a relationship') || 
         false;
}

/**
 * Create a simple update without joins (fallback)
 */
export async function performSimpleUpdate(
  supabase: SupabaseClient,
  tableName: string,
  id: string,
  updateData: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from(tableName)
    .update(updateData)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    if (isTableNotFoundError(error)) {
      throw new Error(`${tableName} table does not exist`);
    }
    throw error;
  }

  return data;
}

/**
 * Calculate total cost from components
 */
export function calculateTotalCost(
  materialCost: number = 0,
  laborCost: number = 0,
  overheadCost: number = 0
): number {
  return materialCost + laborCost + overheadCost;
}
