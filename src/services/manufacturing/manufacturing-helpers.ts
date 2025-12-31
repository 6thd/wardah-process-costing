/**
 * Helper functions for Manufacturing Orders Service
 * Extracted to reduce cognitive complexity
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrderWithItem {
  item_id?: string;
  product_id?: string;
  item?: unknown;
  status?: string;
  [key: string]: unknown;
}

/**
 * Check if error is table not found
 */
export function isTableNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  return err.code === 'PGRST205' || err.message?.includes('Could not find the table') === true;
}

/**
 * Check if error is relationship not found
 */
export function isRelationshipNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  return err.code === 'PGRST200' || err.message?.includes('Could not find a relationship') === true;
}

/**
 * Handle table not found error
 */
export function handleTableNotFound(tableName: string): [] {
  console.warn(`${tableName} table not found, returning empty array`);
  return [];
}

/**
 * Try to fetch orders without joins
 */
export async function fetchOrdersSimple(
  supabase: SupabaseClient,
  limit: number
): Promise<OrderWithItem[]> {
  let query = supabase
    .from('manufacturing_orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    if (isTableNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  return (data || []) as OrderWithItem[];
}

/**
 * Extract unique item IDs from orders
 */
export function extractItemIds(orders: OrderWithItem[]): string[] {
  const ids = orders
    .map(order => order.item_id || order.product_id)
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/**
 * Fetch related items data
 */
export async function fetchRelatedItems(
  supabase: SupabaseClient,
  itemIds: string[]
): Promise<Map<string, unknown>> {
  if (itemIds.length === 0 || itemIds.length > 50) {
    return new Map();
  }

  try {
    const [productsResult, itemsResult] = await Promise.all([
      fetchProducts(supabase, itemIds),
      fetchItems(supabase, itemIds)
    ]);

    const combinedMap = new Map<string, unknown>();
    itemsResult.forEach(item => {
      if (item.id && typeof item.id === 'string') {
        combinedMap.set(item.id, item);
      }
    });
    productsResult.forEach(product => {
      if (product.id && typeof product.id === 'string') {
        combinedMap.set(product.id, product);
      }
    });

    return combinedMap;
  } catch {
    console.warn('Could not load related data');
    return new Map();
  }
}

/**
 * Fetch products
 */
async function fetchProducts(
  supabase: SupabaseClient,
  itemIds: string[]
): Promise<Array<{ id: string; [key: string]: unknown }>> {
  try {
    const res = await supabase
      .from('products')
      .select('id, code, name')
      .in('id', itemIds);
    return (res.data || []) as Array<{ id: string; [key: string]: unknown }>;
  } catch {
    return [];
  }
}

/**
 * Fetch items
 */
async function fetchItems(
  supabase: SupabaseClient,
  itemIds: string[]
): Promise<Array<{ id: string; [key: string]: unknown }>> {
  try {
    const res = await supabase
      .from('items')
      .select('id, code, name, sku')
      .in('id', itemIds);
    return (res.data || []) as Array<{ id: string; [key: string]: unknown }>;
  } catch {
    return [];
  }
}

/**
 * Attach related items to orders
 */
export function attachRelatedItems(
  orders: OrderWithItem[],
  itemsMap: Map<string, unknown>
): void {
  orders.forEach(order => {
    const itemId = order.item_id || order.product_id;
    if (itemId) {
      const relatedData = itemsMap.get(itemId);
      if (relatedData) {
        order.item = relatedData;
      }
    }
  });
}

/**
 * Normalize order status values
 */
export function normalizeOrderStatuses(orders: OrderWithItem[]): void {
  orders.forEach(order => {
    if (order.status === 'in_progress') {
      order.status = 'in-progress';
    } else if (order.status === 'done') {
      order.status = 'completed';
    }
  });
}

